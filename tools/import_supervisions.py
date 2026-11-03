#!/usr/bin/env python3
"""Import Selwyn supervisions + examples papers from Michaelmas_Supervisions_2026.xlsx.

Usage:
  python3 tools/import_supervisions.py ~/Downloads/Michaelmas_Supervisions_2026.xlsx [--group 2] [--part 1A]

- Supervisions for your group are (re)imported as timetable events.
- Examples papers are created once and matched to supervisions in order
  (prep sheet first if the course has one). Papers you've already got are
  never overwritten, so your progress is safe if you re-run this.
- Selwyn-only extras in the lab rows (e.g. the Selwyn 1A test) are added too.
Reload the planner page afterwards.
"""
import argparse
import re
import zipfile
from datetime import date, timedelta
from xml.etree import ElementTree as ET

from planner_data import load, replace_source, save

SOURCE = "selwyn-sups"
EXTRA_SOURCE = "selwyn-extra"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
COURSE_KEYWORDS = [("Dimensional", "px"), ("Structural", "struct"), ("Materials", "mat"), ("Mechanics", "mech"),
                   ("Thermofluid", "mech"), ("vibration", "mech"), ("Electrical", "elec"), ("electronics", "elec"),
                   ("Mathematical", "maths")]

SHORT = {"mech": "Mechanics", "struct": "Structures", "mat": "Materials", "elec": "Electrical",
         "maths": "Maths", "px": "Dimensional Analysis", "other": "Other"}


# ---------- minimal xlsx reader (no third-party packages) ----------
def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group()
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def read_sheet(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    rows = {}
    xml = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    for row in xml.iter(f"{{{NS['m']}}}row"):
        r = int(row.get("r"))
        for c in row.findall("m:c", NS):
            v = c.find("m:v", NS)
            if c.get("t") == "s" and v is not None:
                val = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                val = "".join(e.text or "" for e in c.iter(f"{{{NS['m']}}}t"))
            else:
                val = v.text if v is not None else None
            val = (val or "").replace("\xa0", " ").strip()
            if val:
                rows.setdefault(r, {})[col_index(c.get("r"))] = val
    return rows


# ---------- parsing helpers ----------
def to_24h(t, ref=None):
    h, _, m = t.partition(":")
    h, m = int(h), int(m or 0)
    if h <= 8:          # supervision times like "3-4" or "8-9" are afternoon/evening
        h += 12
    if ref is not None and h * 60 + m <= ref:
        h += 12
    return h * 60 + m


def fmt(mins):
    return f"{mins // 60:02d}:{mins % 60:02d}"


ENTRY = re.compile(r"([A-Z]{2,4}(?:-[A-Za-z0-9]+)?)\s*(?:\(([^)]*)\))?\s*(\d{1,2}(?::\d\d)?)\s*-\s*(\d{1,2}(?::\d\d)?)\s*(?:\(([^)]*)\))?")


def parse_cell(text):
    for m in ENTRY.finditer(" ".join(text.split())):
        code, tag1, a, b, tag2 = m.groups()
        start = to_24h(a)
        end = to_24h(b, start)
        yield code, " ".join(x for x in (tag1, tag2) if x), fmt(start), fmt(end)


def course_for(name):
    for kw, cid in COURSE_KEYWORDS:
        if kw.lower() in name.lower():
            return cid
    return "other"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--group", type=int, default=2)
    ap.add_argument("--part", default="1A")
    args = ap.parse_args()

    rows = read_sheet(args.xlsx)
    # header row for this part: column B == "1A", dates are Excel serials
    header = next(r for r, cells in rows.items() if cells.get(2, "").upper() == args.part.upper())
    dates = {}
    for c, v in rows[header].items():
        if c >= 8 and re.fullmatch(r"\d{5}", v):
            dates[c] = date(1899, 12, 30) + timedelta(int(v))
    first_date_col, pre_term_col = min(dates), min(dates)

    # block ends at the next "Week 1" banner row (start of the next part) or end of sheet
    block_end = min([r for r in rows if r > header and "Week 1" in rows[r].get(9, "")] + [max(rows) + 1])

    # supervisors: rows with a "Name (CODE)" in column C
    supervisors, course_rows = {}, []
    current_code = None
    r = header + 1
    while r < block_end and not rows.get(r, {}).get(2, "").upper().startswith("LABS"):
        cells = rows.get(r, {})
        b, c = cells.get(2, ""), cells.get(3, "")
        m = re.search(r"^(.*?)\s*\(([^)]+)\)\s*$", c)
        if m:
            current_code = m.group(2).strip()
            supervisors.setdefault(current_code, {"name": m.group(1).strip(), "location": cells.get(4, "").strip(),
                                         "course": course_for(b), "title": b})
        if b:
            course_rows.append((r, b, current_code if (m or not c) else None, cells))
        r += 1

    # find our group row
    group_row = next(r for r in range(header, block_end)
                     if re.match(rf"Group\s*{args.group}\s*:", rows.get(r, {}).get(2, "")))
    members = rows[group_row].get(3, "").replace("\n", ", ")

    data = load()
    sup_events = []
    for c, text in sorted(rows[group_row].items()):
        if c not in dates:
            continue
        for code, tag, start, end in parse_cell(text):
            s = supervisors.get(code, {"name": code, "location": "", "course": "other", "title": code})
            short = SHORT.get(s["course"], code)
            d = dates[c]
            sup_events.append({
                "id": f"sup-{d.isoformat()}-{code}", "title": f"Supervision: {short}" + (f" ({tag})" if tag else ""),
                "type": "supervision", "courseId": s["course"], "repeat": "once", "date": d.isoformat(),
                "day": (d.weekday() + 1) % 7, "weeks": "", "start": start, "end": end,
                "location": "" if s["location"].upper() == "TBC" else s["location"],
                "who": s["name"], "notes": ("Location TBC. " if s["location"].upper() == "TBC" else "")
                + f"Supervision group {args.group}: {members}", "source": SOURCE, "code": code,
            })
    sup_events.sort(key=lambda e: (e["date"], e["start"]))
    replace_source(data, SOURCE, sup_events)

    # Selwyn extras in the LABS rows (e.g. "SELWYN 1A TEST 1:30-4:30")
    extras = []
    for r in range(header, block_end):
        cells = rows.get(r, {})
        if not cells.get(2, "").upper().startswith("LABS"):
            continue
        for c, text in cells.items():
            if c in dates and "TEST" in text.upper():
                m = re.search(r"(\d{1,2}(?::\d\d)?)\s*-\s*(\d{1,2}(?::\d\d)?)", text)
                st = to_24h(m.group(1)); en = to_24h(m.group(2), st)
                d = dates[c]
                extras.append({"id": f"extra-{d.isoformat()}-{c}", "title": re.sub(r"\s*\d{1,2}(?::\d\d)?\s*-\s*\d.*$", "", text).title(),
                               "type": "other", "courseId": "other", "repeat": "once", "date": d.isoformat(),
                               "day": (d.weekday() + 1) % 7, "weeks": "", "start": fmt(st), "end": fmt(en),
                               "location": "", "who": "", "notes": "From the Selwyn supervision sheet.",
                               "source": EXTRA_SOURCE})
    replace_source(data, EXTRA_SOURCE, extras)

    # ---------- examples papers ----------
    # per supervisor code: [prep?] + numbered papers (issue dates from the grid), matched to supervisions in order
    by_code = {}
    for r, title, code, cells in course_rows:
        if not code:
            # merged row (e.g. P3b) inherits the supervisor of the row above
            code = by_code and list(by_code)[-1]
        papers = by_code.setdefault(code, [])
        nprep = "prep" in cells.get(6, "").lower()
        course_name = title.split(":")[-1].split("(")[0].strip()
        if nprep:
            papers.append({"number": "Prep sheet", "title": f"{course_name} – {cells.get(7, 'pre-term')}".strip(),
                           "issued": "", "_course": course_for(title)})
        for c, v in sorted(cells.items()):
            if c in dates and re.fullmatch(r"\d+", v) and int(v) > 0:
                papers.append({"number": f"Examples Paper {v}", "title": course_name,
                               "issued": dates[c].isoformat(), "_course": course_for(title)})

    existing = {p["id"] for p in data["papers"]}
    today = date.today().isoformat()
    added = []
    for code, papers in by_code.items():
        sups = [e for e in sup_events if e["code"] == code]
        for i, p in enumerate(papers):
            pid = f"paper-{code}-{p['number'].replace(' ', '')}-{p['title'][:12].replace(' ', '')}"
            if pid in existing:
                continue
            sup = sups[i] if i < len(sups) else None
            due = f"{sup['date']}T{sup['start']}" if sup else ""
            past = bool(due) and due[:10] < today
            paper = {"id": pid, "courseId": p["_course"], "number": p["number"], "title": p["title"],
                     "issued": p["issued"], "due": due, "total": 10, "done": 0,
                     "status": "submitted" if past else "todo",
                     "notes": "" if sup else "No matching supervision found on the sheet — set the due date when you know it.",
                     "source": SOURCE}
            data["papers"].append(paper)
            added.append(paper)

    save(data)
    print(f"Group {args.group} ({members})")
    print(f"Imported {len(sup_events)} supervisions, {len(extras)} extra events, {len(added)} new examples papers.\n")
    for e in sup_events:
        print(f"  {e['date']} {e['start']}-{e['end']}  {e['title']:<55} {e['who']}, {e['location'] or 'TBC'}")
    print()
    for p in added:
        print(f"  [{p['status']:<9}] {p['number']:<17} {p['title']:<45} due {p['due'] or '—'}")


if __name__ == "__main__":
    main()
