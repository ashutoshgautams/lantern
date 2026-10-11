#!/usr/bin/env python3
"""Lantern mapper: walkthrough videos -> offline map pack.

Usage:
    python mapper/map.py <videos_folder> <venue_id> --name "KIIT Campus 15" [--provider gemini|gemma]

Writes app/venues/<venue_id>/map.json + images/<node_id>.jpg
Env: GEMINI_API_KEY, GEMINI_MODEL (default: gemini-flash-latest)
     MODEL_PROVIDER=gemma to map locally with open-weight Gemma (see mapper/gemma.py);
     Gemini is used automatically if Gemma is unavailable or fails.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from google import genai
from google.genai import errors, types

ROOT = Path(__file__).resolve().parent.parent
VENUES = ROOT / "app" / "venues"
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".3gp", ".avi"}
NODE_TYPES = ["entrance", "room", "corridor", "junction", "stairs", "lift",
              "washroom", "canteen", "office", "exit", "other"]

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "nodes": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "id": {"type": "STRING"},
                "name": {"type": "STRING"},
                "type": {"type": "STRING", "enum": NODE_TYPES},
                "floor": {"type": "STRING"},
                "keyframe": {"type": "OBJECT", "properties": {
                    "video": {"type": "STRING"},
                    "timestamp_sec": {"type": "NUMBER"},
                }, "required": ["video", "timestamp_sec"]},
                "step_free": {"type": "BOOLEAN"},
                "visual_cue": {"type": "STRING"},
            },
            "required": ["id", "name", "type", "floor", "keyframe", "step_free", "visual_cue"],
        }},
        "edges": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "from": {"type": "STRING"},
                "to": {"type": "STRING"},
                "approx_steps": {"type": "INTEGER"},
                "hint_forward": {"type": "STRING"},
                "hint_backward": {"type": "STRING"},
                "has_stairs": {"type": "BOOLEAN"},
            },
            "required": ["from", "to", "approx_steps", "hint_forward", "hint_backward", "has_stairs"],
        }},
    },
    "required": ["nodes", "edges"],
}

PROMPT = """You are building an indoor navigation map from walkthrough videos of ONE venue.
A person walked through the venue filming with a phone and narrating place names out loud.
Each video is introduced by a line "VIDEO FILE: <filename>". Use the video AND the narration.

Return a graph:
NODES = distinct places a visitor might want to go to or pass through: entrances, exits, rooms,
corridor junctions/turns, stairs, lifts, washrooms, canteens, offices, notable landmarks.
- id: short lowercase snake_case, unique (e.g. "main_entrance", "room_104").
- name: what a visitor would call it, short, as narrated (e.g. "Room 104", "Main Entrance").
  If not narrated, describe it simply ("Corridor near water cooler").
- type: one of the allowed types. Use "junction" for corridor crossings/turns.
- floor: e.g. "Ground", "1", "2". Infer from narration or stairs/lift usage.
- keyframe: the video filename (exactly as given) and the second where the place is seen most
  clearly, camera steady, facing the place (door, sign, landmark). Must be within that video.
- step_free: true if a wheelchair user can reach it without stairs.
- visual_cue: one short sentence on how to recognise the spot ("Blue door with a red sign above").
IMPORTANT: if the walker comes back to a place ("back at the main corridor", or it clearly looks
the same), or the same place appears in two videos, it must be ONE node. Never duplicate places.

EDGES = direct walkable connections between two nodes, in the order the walker moved (from -> to).
- approx_steps: estimated walking steps between them (roughly 1 step per second of walking).
- hint_forward: plain, short instruction for walking from -> to, using landmarks, e.g.
  "Turn left after the notice board" or "Go straight down the corridor".
- hint_backward: the correct instruction for walking to -> from. Think about it from the
  opposite direction: a left turn going forward becomes a RIGHT turn going back, "on your left"
  becomes "on your right", "go up the stairs" becomes "go down the stairs". Do not just copy.
- has_stairs: true if this connection uses stairs.
Every node must be connected to at least one other node. Use simple words a grandmother understands.
"""


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_")
    return s or "place"


def load_env():
    """Read KEY=value lines from lantern/.env so the API key never has to be typed in a command."""
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            k, sep, v = line.strip().partition("=")
            if sep and not k.startswith("#"):
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def make_proxy(src, tmp):
    """Small 720p H.264 copy for upload: phone videos (often HEVC, 100s of MB) upload in seconds this way.
    Photos are still cut from the full-quality originals."""
    out = Path(tmp) / (src.stem + ".mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf", "scale=-2:'min(720,ih)'",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "64k",
                    str(out)], check=True)
    return out


def upload_videos(client, paths, tmp):
    files = []
    for p in paths:
        print(f"Compressing and uploading {p.name} ...", flush=True)
        f = client.files.upload(file=str(make_proxy(p, tmp)))
        # Videos must finish server-side processing before they can be used in a prompt.
        while f.state and f.state.name == "PROCESSING":
            time.sleep(5)
            f = client.files.get(name=f.name)
        if f.state and f.state.name == "FAILED":
            sys.exit(f"Gemini could not process {p.name}")
        files.append(f)
    return files


def ask_gemini(client, model, videos, files):
    parts = []
    for p, f in zip(videos, files):
        parts += [f"VIDEO FILE: {p.name}", f]
    parts.append(PROMPT)
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=SCHEMA,
        temperature=0.2,
    )
    for attempt in range(1, 6):
        print(f"Asking {model} to build the map (this can take a few minutes) ...", flush=True)
        try:
            resp = client.models.generate_content(model=model, contents=parts, config=config)
            return json.loads(resp.text)
        except errors.APIError as e:
            # 429/503 = busy or rate-limited: temporary, so wait and retry (uploads are reused).
            if e.code not in (429, 500, 503) or attempt == 5:
                raise
            wait = 15 * attempt
            print(f"  Gemini is busy ({e.code}). Trying again in {wait}s (attempt {attempt}/5) ...", flush=True)
            time.sleep(wait)


def clean(graph, video_names):
    """Make the AI output safe: unique ids, valid refs, no duplicate/self edges."""
    nodes, ids, remap = [], set(), {}
    for n in graph.get("nodes", []):
        base = slug(n.get("id") or n.get("name"))
        nid, i = base, 2
        while nid in ids:
            nid, i = f"{base}_{i}", i + 1
        ids.add(nid)
        remap.setdefault(n.get("id"), nid)
        kf = n.get("keyframe") or {}
        if kf.get("video") not in video_names:
            kf["video"] = video_names[0]
        nodes.append({
            "id": nid,
            "name": (n.get("name") or nid).strip(),
            "type": n.get("type") if n.get("type") in NODE_TYPES else "other",
            "floor": str(n.get("floor") or ""),
            "keyframe": {"video": kf["video"], "timestamp_sec": max(0.0, float(kf.get("timestamp_sec") or 0))},
            "step_free": bool(n.get("step_free", True)),
            "visual_cue": (n.get("visual_cue") or "").strip(),
        })
    edges, seen = [], set()
    for e in graph.get("edges", []):
        a, b = remap.get(e.get("from")), remap.get(e.get("to"))
        if not a or not b or a == b or frozenset((a, b)) in seen:
            continue
        seen.add(frozenset((a, b)))
        edges.append({
            "from": a, "to": b,
            "approx_steps": max(1, int(e.get("approx_steps") or 10)),
            "hint_forward": (e.get("hint_forward") or "").strip(),
            "hint_backward": (e.get("hint_backward") or "").strip(),
            "has_stairs": bool(e.get("has_stairs", False)),
        })
    return nodes, edges


def extract_keyframes(nodes, video_dir, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    for n in nodes:
        kf = n["keyframe"]
        out = out_dir / f"{n['id']}.jpg"
        # -ss before -i = fast seek; 800px wide, q:v 5 is roughly JPEG quality 70.
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(kf["timestamp_sec"]),
               "-i", str(video_dir / kf["video"]), "-frames:v", "1",
               "-vf", "scale='min(800,iw)':-2", "-q:v", "5", str(out)]
        subprocess.run(cmd, check=False)
        if not out.exists():
            # Timestamp past the end of the video: fall back to the first second.
            cmd[cmd.index("-ss") + 1] = "1"
            subprocess.run(cmd, check=False)
        print(("  ok    " if out.exists() else "  MISSING ") + f"{n['id']}.jpg")


def update_index(venue_id, name):
    path = VENUES / "index.json"
    idx = json.loads(path.read_text()) if path.exists() else {"venues": []}
    idx["venues"] = [v for v in idx["venues"] if v["id"] != venue_id] + [{"id": venue_id, "name": name}]
    path.write_text(json.dumps(idx, indent=2, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description="Turn walkthrough videos into a Lantern map pack.")
    ap.add_argument("videos", help="folder with the walkthrough videos of one venue")
    ap.add_argument("venue_id", help="short id used in URLs, e.g. kiit_campus15")
    ap.add_argument("--name", help="venue name shown to visitors")
    ap.add_argument("--provider", choices=["gemini", "gemma"], help="AI that builds the map (default: gemini)")
    args = ap.parse_args()

    load_env()
    if subprocess.run(["which", "ffmpeg"], capture_output=True).returncode:
        sys.exit("Please install ffmpeg (macOS: brew install ffmpeg)")
    video_dir = Path(args.videos)
    videos = sorted(p for p in video_dir.iterdir() if p.suffix.lower() in VIDEO_EXT)
    if not videos:
        sys.exit(f"No videos found in {video_dir}")
    venue_id = slug(args.venue_id)
    provider = (args.provider or os.environ.get("MODEL_PROVIDER") or "gemini").lower()

    graph = None
    if provider == "gemma":
        import gemma  # local import: the Gemini path never depends on it
        try:
            with tempfile.TemporaryDirectory() as tmp:
                graph, used = gemma.ask_gemma(videos, PROMPT, SCHEMA, tmp)
        except Exception as e:
            print(f"Gemma did not work ({e}). Falling back to Gemini.", flush=True)

    if graph is None:
        if not os.environ.get("GEMINI_API_KEY"):
            sys.exit("Please set GEMINI_API_KEY (or put GEMINI_API_KEY=... in lantern/.env)")
        used = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
        client = genai.Client()
        with tempfile.TemporaryDirectory() as tmp:
            files = upload_videos(client, videos, tmp)
        try:
            graph = ask_gemini(client, used, videos, files)
        finally:
            for f in files:
                try:
                    client.files.delete(name=f.name)
                except Exception:
                    pass

    nodes, edges = clean(graph, [p.name for p in videos])
    out = VENUES / venue_id
    print(f"{used} found {len(nodes)} places and {len(edges)} paths. Extracting photos ...")
    extract_keyframes(nodes, video_dir, out / "images")
    name = args.name or venue_id.replace("_", " ").title()
    (out / "map.json").write_text(json.dumps(
        {"venue": {"id": venue_id, "name": name, "app_url": ""}, "generated_by": used, "nodes": nodes, "edges": edges},
        indent=2, ensure_ascii=False))
    update_index(venue_id, name)
    print(f"\nSaved {out / 'map.json'}\nNext: review it with\n  python mapper/review/server.py {venue_id}")


if __name__ == "__main__":
    main()
