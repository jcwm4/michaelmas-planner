#!/usr/bin/env python3
"""Copy examples-paper PDFs into the private data repo and attach them to papers.

Usage:
  python3 tools/sync_papers.py                 # default folder below
  python3 tools/sync_papers.py "/path/to/Example Papers"
  python3 tools/sync_papers.py --dry-run

The folder holds one sub-folder per course ("Mechanics Example Papers", ...).
Each PDF is matched to a paper by course (from the sub-folder name) and paper
number (from the file name). New or changed PDFs are uploaded; unchanged ones
are skipped, so it is safe to re-run whenever you add files.
"""
import hashlib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from planner_data import DATA, load, save  # noqa: E402

DEFAULT_DIR = Path.home() / "Documents" / "IA Engineering" / "Example Papers"
PAPERS_DIR = DATA.parent / "papers"

# sub-folder keyword -> (courseId, word that must appear in the paper's title)
FOLDERS = [
    ("circuit analysis", "elec", "circuits"),
    ("ppe", "elec", "physical principles"),
    ("physical principles", "elec", "physical principles"),
    ("digital", "elec", "digital"),
    ("dimensional", "px", "dimensional"),
    ("computing", "maths", "computing"),
    ("maths", "maths", "mathematics"),
    ("mechanics", "mech", "mechanics"),
    ("structures", "struct", "structural"),
    ("materials", "mat", "materials"),
]


def git_blob_sha(b: bytes) -> str:
    """Same hash GitHub reports for the file, used by the app as a cache key."""
    return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()


def paper_number(name: str):
    s = name.lower()
    if "prep" in s:
        return "prep"
    m = re.search(r"(?:paper|sheet|examples)[\s_-]*(\d{1,2})(?!\d)", s)
    return int(m[1]) if m else None


def find_paper(papers, folder: str, num):
    f = folder.lower()
    rule = next(((cid, kw) for key, cid, kw in FOLDERS if key in f), None)
    if not rule or num is None:
        return None
    cid, kw = rule
    for p in papers:
        if p.get("courseId") != cid or kw not in (p.get("title") or "").lower():
            continue
        pn = (p.get("number") or "").lower()
        if (num == "prep" and "prep" in pn) or (num != "prep" and re.search(rf"\b{num}\b", pn)):
            return p
    return None


def sync_papers(data, root, dry=False):
    """Attach new/changed PDFs from root to data["papers"]. Returns (added lines, unchanged count, unmatched)."""
    PAPERS_DIR.mkdir(exist_ok=True)
    added, same, unmatched = [], 0, []
    for pdf in sorted(root.rglob("*.pdf")):
        p = find_paper(data["papers"], pdf.parent.name, paper_number(pdf.stem))
        if not p:
            unmatched.append(pdf.relative_to(root))
            continue
        body = pdf.read_bytes()
        sha = git_blob_sha(body)
        if p.get("pdfSha") == sha:
            same += 1
            continue
        rel = f"papers/{p['id']}.pdf"
        added.append(f"{pdf.relative_to(root)}  →  {p['number']} — {p['title']}")
        if not dry:
            (DATA.parent / rel).write_bytes(body)
            p.update(pdf=rel, pdfSha=sha, pdfName=pdf.name)
    return added, same, unmatched


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    root = Path(args[0]).expanduser() if args else DEFAULT_DIR
    if not root.is_dir():
        sys.exit(f"Folder not found: {root}")
    data = load()
    added, same, unmatched = sync_papers(data, root, dry)
    for line in added:
        print("  +", line)
    print(f"{len(added)} new/updated, {same} unchanged.")
    if unmatched:
        print("Couldn't match (rename with the paper number, or attach in the app):")
        for u in unmatched:
            print("  ?", u)
    if added and not dry:
        save(data, f"Attach {len(added)} examples paper PDF(s)", extra=["papers"])


if __name__ == "__main__":
    main()
