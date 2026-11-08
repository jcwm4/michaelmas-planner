#!/usr/bin/env python3
"""Build the search index of text inside your PDFs (handouts, data books, examples papers).

Run automatically by sync_library.py. Text is pulled out with macOS's built-in PDFKit
(no installs) and saved to search/index.json in the PRIVATE data repo, which the app
downloads when you search. Only new or changed PDFs are re-read.

  python3 tools/build_search.py      # rebuild/update on its own
"""
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from planner_data import DATA, load, save  # noqa: E402
from sync_papers import git_blob_sha  # noqa: E402

REPO = DATA.parent
INDEX = "search/index.json"
PDFTEXT = Path(__file__).resolve().parent / "pdftext.js"


def clean(t: str) -> str:
    t = t.replace("­", "").replace("ﬁ", "fi").replace("ﬂ", "fl")
    t = re.sub(r"-\n(?=[a-z])", "", t)          # re-join hyphenated line breaks
    return re.sub(r"\s+", " ", t).strip()


def extract(paths):
    out = {}
    for i in range(0, len(paths), 20):
        chunk = paths[i:i + 20]
        r = subprocess.run(["osascript", "-l", "JavaScript", str(PDFTEXT), *map(str, chunk)], capture_output=True, text=True)
        if r.returncode != 0:
            print("  ! couldn't read text from some PDFs:", r.stderr.strip()[:200])
            continue
        out.update(json.loads(r.stdout))
    return out


def build_index(data) -> bool:
    """Update search/index.json for every PDF the planner knows about. Returns True if it changed."""
    docs = [(d["path"], d.get("sha")) for d in data.get("library", [])]
    docs += [(p["pdf"], p.get("pdfSha")) for p in data.get("papers", []) if p.get("pdf")]
    f = REPO / INDEX
    old = {}
    if f.exists():
        try:
            old = {d["path"]: d for d in json.loads(f.read_text())["docs"]}
        except (ValueError, KeyError):
            old = {}
    keep, todo = [], []
    for path, sha in docs:
        src = REPO / path
        if not src.is_file():
            continue
        sha = sha or git_blob_sha(src.read_bytes())
        if path in old and old[path].get("sha") == sha:
            keep.append(old[path])
        else:
            todo.append((path, sha))
    if todo:
        print(f"Search: reading text from {len(todo)} PDF(s)…")
        got = extract([REPO / p for p, _ in todo])
        for path, sha in todo:
            pages = got.get(str(REPO / path))
            if pages is not None:
                keep.append({"path": path, "sha": sha, "pages": [clean(t) for t in pages]})
    keep.sort(key=lambda d: d["path"])
    body = json.dumps({"version": 1, "docs": keep}, ensure_ascii=False, separators=(",", ":")).encode()
    sha = git_blob_sha(body)
    if (data.get("searchIndex") or {}).get("sha") == sha and f.exists():
        return False
    f.parent.mkdir(exist_ok=True)
    f.write_bytes(body)
    data["searchIndex"] = {"path": INDEX, "sha": sha}
    pages = sum(len(d["pages"]) for d in keep)
    print(f"Search: indexed {len(keep)} PDFs, {pages} pages ({len(body) / 1e6:.1f} MB)")
    return True


if __name__ == "__main__":
    d = load()
    if build_index(d):
        save(d, "Update PDF search index", extra=["search"])
    else:
        print("Search index already up to date.")
