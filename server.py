#!/usr/bin/env python3
"""Local server for the Michaelmas Planner.

Serves the site from ./public and stores all planner data in ./data/planner.json.
Run:  python3 server.py   then open http://localhost:8000
"""
import json
import os
import shutil
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA_DIR = ROOT / "data"
DATA = DATA_DIR / "planner.json"
PORT = int(os.environ.get("PORT", "8000"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, code, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/data":
            body = DATA.read_bytes() if DATA.exists() else b"null"
            return self._send_json(200, body)
        if self.path.startswith("/api/file?"):
            from urllib.parse import parse_qs, urlsplit
            rel = parse_qs(urlsplit(self.path).query).get("path", [""])[0]
            f = (DATA_DIR / rel).resolve()
            allowed = [(DATA_DIR / d).resolve() for d in ("papers", "library")]
            is_index = f == (DATA_DIR / "search" / "index.json").resolve()
            if not f.is_file() or not (is_index or (f.suffix == ".pdf" and any(f.is_relative_to(a) for a in allowed))):
                return self._send_json(404, b'{"error":"not found"}')
            body = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        return super().do_GET()

    def do_PUT(self):
        if self.path.split("?")[0] != "/api/data":
            return self._send_json(404, b'{"error":"not found"}')
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
            if not isinstance(data, dict) or "settings" not in data:
                raise ValueError("missing settings")
        except Exception as exc:  # noqa: BLE001
            return self._send_json(400, json.dumps({"error": str(exc)}).encode())
        DATA_DIR.mkdir(exist_ok=True)
        if DATA.exists():
            shutil.copy2(DATA, DATA_DIR / "planner.backup.json")
        tmp = DATA_DIR / "planner.json.tmp"
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, DATA)
        return self._send_json(200, b'{"ok":true}')

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"Michaelmas Planner running at {url}  (Ctrl+C to stop)")
    print(f"Data file: {DATA}")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
