"""Open-model provider for the Lantern mapper: Gemma (via Ollama) + whisper.cpp, fully local.

Gemma sees sampled video frames, whisper.cpp turns the walker's narration into timestamped text,
and Gemma returns the same JSON map as the Gemini provider. No video leaves the laptop.

Env: GEMMA_MODEL (default gemma4:12b), OLLAMA_HOST (default http://localhost:11434),
     WHISPER_MODEL (default ~/.lantern/models/ggml-small.bin)
Stdlib only: Ollama and whisper.cpp are called over HTTP / CLI, so no extra pip packages.
"""
import base64
import json
import os
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path

MAX_FRAMES = 60  # ~280 image tokens each keeps the whole venue well inside Gemma's context


def _duration(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(video)], capture_output=True, text=True)
    return float(out.stdout.strip() or 0)


def _frames(video, every, tmp):
    """One small JPEG every `every` seconds -> [(second, base64_jpeg)]."""
    folder = Path(tmp) / f"frames_{video.stem}"
    folder.mkdir()
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(video), "-vf", f"fps=1/{every},scale=512:-2",
                    "-q:v", "5", str(folder / "%04d.jpg")], check=True)
    return [((i) * every, base64.b64encode(f.read_bytes()).decode())
            for i, f in enumerate(sorted(folder.glob("*.jpg")))]


def _transcript(video, tmp):
    """Timestamped narration via whisper.cpp; empty if whisper is not installed (Gemma still sees frames)."""
    model = Path(os.environ.get("WHISPER_MODEL", "~/.lantern/models/ggml-small.bin")).expanduser()
    cli = shutil.which("whisper-cli")
    if not cli or not model.exists():
        print("  (whisper.cpp not found: mapping from video frames only)")
        return ""
    wav = Path(tmp) / f"{video.stem}.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(video), "-ar", "16000", "-ac", "1", str(wav)], check=True)
    out = subprocess.run([cli, "-m", str(model), "-f", str(wav), "-l", "auto", "-np"],
                         capture_output=True, text=True).stdout
    lines = []
    for m in re.finditer(r"\[(\d+):(\d+):(\d+)\.\d+ --> [^\]]+\]\s*(.+)", out):
        sec = int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3])
        lines.append(f"  [{sec}s] {m[4].strip()}")
    return "\n".join(lines)


def _json_schema(s):
    """Gemini-style schema ("OBJECT") -> standard JSON Schema ("object") for Ollama's `format`."""
    if isinstance(s, dict):
        # Only the schema keyword "type" (a string) changes case; a *property* named "type" is a dict.
        return {k: (v.lower() if k == "type" and isinstance(v, str) else _json_schema(v)) for k, v in s.items()}
    if isinstance(s, list):
        return [_json_schema(x) for x in s]
    return s


def ask_gemma(videos, prompt, schema, tmp):
    model = os.environ.get("GEMMA_MODEL", "gemma4:12b")
    host = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
    total = sum(_duration(v) for v in videos)
    every = max(2, round(total / MAX_FRAMES))

    messages = [{"role": "system", "content": "You map indoor venues for blind-friendly, offline navigation. Answer with JSON only."}]
    notes = []
    for v in videos:
        print(f"  Reading {v.name}: frames every {every}s + narration ...", flush=True)
        for sec, img in _frames(v, every, tmp):
            messages.append({"role": "user", "content": f"VIDEO FILE: {v.name} — frame at {sec}s", "images": [img]})
        t = _transcript(v, tmp)
        notes.append(f"VIDEO FILE: {v.name}\nNarration (spoken by the walker):\n{t or '  (none)'}")
    messages.append({"role": "user", "content": "\n\n".join(notes) + "\n\n" + prompt +
                     f"\nFor keyframe.timestamp_sec use one of the frame times shown above (multiples of {every})." +
                     "\nReply with ONE JSON object only (no markdown, no prose) that matches this JSON Schema:\n" +
                     json.dumps(_json_schema(schema))})

    # Ollama's schema-enforced output isn't available for every model, so the schema is in the
    # prompt and the reply is parsed here; map.py's clean() still validates every field.
    for attempt in (1, 2):
        print(f"Asking {model} (local, open-weight) to build the map ...", flush=True)
        reply = _chat(host, model, messages)
        try:
            graph = _parse_json(reply)
            if graph.get("nodes"):
                return graph, model
        except ValueError:
            pass
        messages += [{"role": "assistant", "content": reply},
                     {"role": "user", "content": "That was not a valid JSON object with nodes and edges. Reply with the JSON object only."}]
    raise ValueError("Gemma did not return a usable map")


def _chat(host, model, messages):
    # think=False + an output cap: a full venue map is ~3k tokens, so anything longer is a runaway loop.
    body = json.dumps({"model": model, "messages": messages, "stream": False, "think": False,
                       "options": {"temperature": 0.2, "num_ctx": 32768, "num_predict": 8192,
                                   "repeat_penalty": 1.1}}).encode()
    req = urllib.request.Request(f"{host}/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        return json.loads(r.read())["message"]["content"]


def _parse_json(text):
    """Take the outermost {...} so stray ```json fences or a sentence around it don't matter."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in reply")
    return json.loads(text[start:end + 1])
