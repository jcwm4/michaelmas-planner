"""Shared helpers for the import scripts: load/save data/planner.json and the course list.

If data/ is a clone of your private data repo, load() pulls the latest copy first and
save() commits and pushes the change, so the web app picks it up straight away.
"""
import json
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "planner.json"

# Part IA Michaelmas courses (ids are referenced by the import scripts)
COURSES = [
    {"id": "mech", "name": "1P1 Mechanics", "color": "#e4572e"},
    {"id": "struct", "name": "1P2 Structures", "color": "#2b59c3"},
    {"id": "mat", "name": "1P2 Materials", "color": "#2e8b57"},
    {"id": "elec", "name": "1P3 Electrical", "color": "#c77c02"},
    {"id": "maths", "name": "1P4 Maths & Computing", "color": "#8e44ad"},
    {"id": "px", "name": "1PX Dimensional Analysis & Society", "color": "#d63384"},
    {"id": "labs", "name": "Labs & Coursework", "color": "#16a2b8"},
    {"id": "other", "name": "Other", "color": "#7f8c8d"},
]


def _git(*args):
    return subprocess.run(["git", "-C", str(DATA.parent), *args], capture_output=True, text=True)


def _is_repo():
    return (DATA.parent / ".git").exists()


def load():
    if _is_repo():
        r = _git("pull", "--ff-only", "--quiet")
        if r.returncode != 0:
            raise SystemExit(f"Couldn't pull the latest data from your private repo:\n{r.stderr}")
    data = json.loads(DATA.read_text()) if DATA.exists() else None
    if not data:
        data = {"version": 1, "settings": {}}
    for k in ("events", "papers", "tasks"):
        data.setdefault(k, [])
    # add any missing standard courses, keep user edits to existing ones
    courses = data.get("courses") or []
    have = {c["id"] for c in courses}
    courses += [dict(c) for c in COURSES if c["id"] not in have]
    data["courses"] = courses
    return data


def save(data, message="Update from import script"):
    DATA.parent.mkdir(exist_ok=True)
    DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    if _is_repo():
        _git("add", DATA.name)
        if _git("diff", "--cached", "--quiet").returncode == 0:
            print("(no changes to upload)")
            return
        _git("commit", "--quiet", "-m", f"{message} ({datetime.now():%Y-%m-%d %H:%M})")
        r = _git("push", "--quiet")
        print("Uploaded to your private data repo." if r.returncode == 0 else f"Saved locally but push failed:\n{r.stderr}")


def replace_source(data, source, events):
    data["events"] = [e for e in data["events"] if e.get("source") != source] + events
