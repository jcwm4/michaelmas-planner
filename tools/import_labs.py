#!/usr/bin/env python3
"""Import a CUED lab calendar (.ics) into data/planner.json.

Usage:
  python3 tools/import_labs.py 16-18            # downloads the group 16-18 Michaelmas feed
  python3 tools/import_labs.py path/to/file.ics

Re-running is safe: previously imported lab events are replaced, everything
else (your own events, papers, tasks) is left untouched.
Reload the planner page in your browser afterwards.
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "planner.json"
FEED = "https://teach-cals.eng.cam.ac.uk/cued-labs/2026/ia/mich/{}.ics"
LONDON = ZoneInfo("Europe/London")
SOURCE_TAG = "cued-labs"
# College-specific locations for sessions the department lists as "See Moodle"
LOCATION_OVERRIDES = {"Exposition": "MR4, Old Library (Selwyn)"}


def read_ics(arg: str) -> str:
    if re.fullmatch(r"\d+-\d+", arg):
        req = urllib.request.Request(FEED.format(arg), headers={"User-Agent": "michaelmas-planner"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8")
    return Path(arg).read_text(encoding="utf-8")


def unescape(s: str) -> str:
    return s.replace("\\,", ",").replace("\\;", ";").replace("\\n", "\n").replace("\\\\", "\\")


def clean_title(t: str) -> str:
    # "Lego Mindstorms (2-4pm)" -> "Lego Mindstorms"; "Dimensional Analysis (Structures, am)" -> "... (Structures)"
    def fix(m):
        parts = [p.strip() for p in m.group(1).split(",")]
        keep = [p for p in parts if not re.search(r"\b(am|pm|slot)\b|\d-\d", p)]
        return f" ({', '.join(keep)})" if keep else ""
    return re.sub(r"\s*\(([^)]*)\)", fix, t).strip()


def parse(text: str):
    text = re.sub(r"\r?\n[ \t]", "", text)  # unfold lines
    events = []
    for block in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, re.S):
        f = dict(re.findall(r"^([A-Z-]+)[^:\n]*:(.*?)\r?$", block, re.M))

        def dt(s):
            d = datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            return d.astimezone(LONDON)

        start, end = dt(f["DTSTART"]), dt(f["DTEND"])
        location = unescape(f.get("LOCATION", "")).split(" - ")[0].strip()
        location = re.sub(r"\s{2,}", " ", location)
        desc = unescape(f.get("DESCRIPTION", ""))
        link = re.search(r"Information:\s*(\S+)", desc)
        events.append({
            "id": "lab-" + re.sub(r"[^A-Za-z0-9]", "", f["UID"].split("@")[0]) + start.strftime("%m%d%H%M"),
            "title": clean_title(unescape(f["SUMMARY"])),
            "type": "lab",
            "courseId": "labs",
            "repeat": "once",
            "date": start.strftime("%Y-%m-%d"),
            "day": (start.weekday() + 1) % 7,
            "weeks": "",
            "start": start.strftime("%H:%M"),
            "end": end.strftime("%H:%M"),
            "location": "" if location.lower() == "see moodle" else location,
            "who": "",
            "notes": "See Moodle for location." if location.lower() == "see moodle" else "",
            "link": link.group(1) if link else "",
            "source": SOURCE_TAG,
        })
    for e in events:
        if e["title"] in LOCATION_OVERRIDES and not e["location"]:
            e["location"] = LOCATION_OVERRIDES[e["title"]]
            e["notes"] = e["notes"].replace("See Moodle for location.", "With Prof Moultrie.")
    return sorted(events, key=lambda e: (e["date"], e["start"]))


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    from planner_data import load, replace_source, save
    events = parse(read_ics(sys.argv[1]))
    data = load()
    replace_source(data, SOURCE_TAG, events)
    save(data, "Import lab timetable")
    print(f"Imported {len(events)} lab sessions")
    for e in events:
        print(f"  {e['date']} {e['start']}-{e['end']}  {e['title']}  [{e['location'] or 'see Moodle'}]")


if __name__ == "__main__":
    main()
