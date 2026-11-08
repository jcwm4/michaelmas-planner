#!/usr/bin/env python3
"""Sync your IA Engineering folder into the planner (private data repo).

Usage:
  python3 tools/sync_library.py              # ~/Documents/IA Engineering
  python3 tools/sync_library.py --dry-run    # show what would change

Syncs three things, uploading only new or changed files:
  Example Papers/<course> Example Papers/*.pdf   -> attached to each examples paper
  Data Books/*.pdf                                -> Data Books tab
  Lecture Handouts/<course> Handouts/*.pdf        -> Lectures tab, grouped by course

Data books and handouts mirror the folder: delete or rename a file there and it
is removed from the planner on the next sync. (Files you attached in the app
itself are left alone.) Titles you rename in the app are kept.

It also updates the search index of text inside every PDF (see build_search.py).
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from planner_data import DATA, load, save  # noqa: E402
from sync_papers import git_blob_sha, sync_papers  # noqa: E402
from build_search import build_index  # noqa: E402

ROOT_DIR = Path.home() / "Documents" / "IA Engineering"
REPO = DATA.parent
KEEP_WORDS = {"handout", "handouts", "section", "lecture", "lectures", "slides", "notes", "part", "chapter", "summary", "examples"}
STOP = {"in", "by", "for", "the", "of", "and", "version", "moodle"}


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "file"


def tokens(stem: str):
    s = stem.replace("_", " ")
    s = re.sub(r"(?<=[A-Za-z]{3})(?=\d)", " ", s)   # Handout1 -> Handout 1 (but not A4)
    return [t for t in re.split(r"\s+", s) if t]


def tidy(words):
    out = " ".join(w.capitalize() if w.isupper() and len(w) > 3 else w for w in words)
    return out[:1].upper() + out[1:]


NOISE = {"partia", "ia", "p1a", "1a", "mich", "michaelmas", "filled", "complete", "jma", "a4", "accts", "tb", "-", "v"}


def denoise(ts, group):
    """Drop course-name words, years and filler like 'PartIA', 'Mich', 'filled', 'A4'."""
    gwords = [w.lower() for w in re.findall(r"[A-Za-z]+", group or "") if len(w) > 2]
    out = []
    for t in ts:
        w = t.lower().strip("()")
        if w in NOISE or re.fullmatch(r"(19|20)\d\d", w) or any(w.startswith(g[:5]) for g in gwords):
            continue
        out.append(t)
    return out


def titles_for(files, strip_common: bool, group=""):
    """Readable titles; within a course, drop words every file shares (e.g. 'PartIA Maths Mich 2026')."""
    toks = {f: (denoise(tokens(f.stem), group) or tokens(f.stem)) if strip_common else tokens(f.stem) for f in files}
    common = set()
    if strip_common and len(files) > 1:
        sets = [{t.lower() for t in ts} for ts in toks.values()]
        common = set.intersection(*sets) - KEEP_WORDS
    out = {}
    for f, ts in toks.items():
        kept = [t for t in ts if t.lower() not in common and not (strip_common and t.lower() in STOP)]
        t = tidy(kept or ts)
        out[f] = re.sub(r"^Slide\b", "Slides", t)
    return out


def natural(s):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", s)]


def sync_kind(data, kind, folder: Path, group_of, strip_common, dry):
    """Mirror PDFs under folder into data['library'] entries of this kind."""
    lib = data.setdefault("library", [])
    files = sorted(folder.rglob("*.pdf")) if folder.is_dir() else []
    by_group = {}
    for f in files:
        by_group.setdefault(group_of(f), []).append(f)
    seen, changes = set(), []
    for group, fs in by_group.items():
        names = titles_for(fs, strip_common, group)
        for f in fs:
            sub = f"{slug(group)}/" if kind == "handout" else ""
            path = f"library/{kind}s/{sub}{slug(f.stem)}.pdf"
            seen.add(path)
            body = f.read_bytes()
            sha = git_blob_sha(body)
            entry = next((e for e in lib if e.get("path") == path), None)
            if entry and entry.get("sha") == sha:
                continue
            changes.append(f"{'~' if entry else '+'} {f.relative_to(folder)}")
            if dry:
                continue
            (REPO / path).parent.mkdir(parents=True, exist_ok=True)
            (REPO / path).write_bytes(body)
            if entry:
                entry.update(sha=sha, name=f.name, size=len(body))
            else:
                lib.append({"id": path, "kind": kind, "group": group, "title": names[f], "path": path,
                            "sha": sha, "name": f.name, "size": len(body), "src": "folder"})
    # files removed from the folder
    for e in [e for e in lib if e.get("kind") == kind and e.get("src") == "folder" and e["path"] not in seen]:
        changes.append(f"- {e['name']}")
        if not dry:
            lib.remove(e)
            (REPO / e["path"]).unlink(missing_ok=True)
    lib.sort(key=lambda e: (e["kind"], e.get("group", "").lower(), natural(e["title"])))
    return changes


def main():
    dry = "--dry-run" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = Path(args[0]).expanduser() if args else ROOT_DIR
    if not root.is_dir():
        sys.exit(f"Folder not found: {root}")
    data = load()
    total = 0

    added, same, unmatched = sync_papers(data, root / "Example Papers", dry) if (root / "Example Papers").is_dir() else ([], 0, [])
    print(f"Examples papers: {len(added)} new/updated, {same} unchanged")
    for a in added:
        print("   +", a)
    for u in unmatched:
        print("   ? couldn't match", u, "(rename it with the paper number, or attach it in the app)")
    total += len(added)

    ch = sync_kind(data, "databook", root / "Data Books", lambda f: "Data books", False, dry)
    print(f"Data books: {len(ch)} change(s)")
    for c in ch:
        print("  ", c)
    total += len(ch)

    hroot = root / "Lecture Handouts"
    group_of = lambda f: re.sub(r"\s*handouts?$", "", f.relative_to(hroot).parts[0], flags=re.I).strip() if len(f.relative_to(hroot).parts) > 1 else "Other"
    ch = sync_kind(data, "handout", hroot, group_of, True, dry)
    if hroot.is_dir():   # remember every course folder, even empty ones, so the Lectures tab can show them
        groups = sorted(re.sub(r"\s*handouts?$", "", d.name, flags=re.I).strip() for d in hroot.iterdir() if d.is_dir())
        if groups != data.get("handoutGroups"):
            data["handoutGroups"] = groups
            total += 1
    print(f"Lecture handouts: {len(ch)} change(s)")
    for c in ch:
        print("  ", c)
    total += len(ch)

    if not dry and build_index(data):   # text inside the PDFs, for the app's search
        total += 1

    if dry:
        print("(dry run — nothing uploaded)")
    elif total:
        save(data, "Sync files from IA Engineering folder", extra=["papers", "library", "search"])
    else:
        print("Everything already up to date.")


if __name__ == "__main__":
    main()
