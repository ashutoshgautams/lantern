#!/usr/bin/env python3
"""Local review page for one venue's map pack (stdlib only).

Usage: python mapper/review/server.py <venue_id> [--port 8000]
"""
import argparse
import json
import shutil
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENUES = HERE.parent.parent / "app" / "venues"
BACKUPS = HERE.parent / "backups"  # outside app/ so backups are never deployed


def make_handler(venue_dir):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(venue_dir), **kw)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                body = (HERE / "index.html").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()  # map.json and images/* from the venue folder

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_POST(self):
            if self.path != "/save":
                return self.send_error(404)
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            map_path = venue_dir / "map.json"
            BACKUPS.mkdir(exist_ok=True)
            shutil.copy(map_path, BACKUPS / f"{venue_dir.name}.map.json.bak")  # one-step undo
            map_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
            # Remove photos of deleted/merged nodes so the offline pack stays small.
            keep = {f"{n['id']}.jpg" for n in data["nodes"]}
            for img in (venue_dir / "images").glob("*.jpg"):
                if img.name not in keep:
                    img.unlink()
            idx_path = VENUES / "index.json"
            idx = json.loads(idx_path.read_text()) if idx_path.exists() else {"venues": []}
            v = data["venue"]
            idx["venues"] = [x for x in idx["venues"] if x["id"] != v["id"]] + [{"id": v["id"], "name": v["name"]}]
            idx_path.write_text(json.dumps(idx, indent=2, ensure_ascii=False))
            body = b'{"ok": true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("venue_id")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    venue_dir = VENUES / args.venue_id
    if not (venue_dir / "map.json").exists():
        sys.exit(f"No map found at {venue_dir / 'map.json'}. Run mapper/map.py first.")
    url = f"http://localhost:{args.port}/"
    print(f"Review page: {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(venue_dir)).serve_forever()


if __name__ == "__main__":
    main()
