#!/usr/bin/env python3
"""Apply the department's Part IA Michaelmas 2026 examples-paper rota (paper issued / solutions issued).

Usage:  python3 tools/import_paper_rota.py
Only the issue date, solutions date and title of matching papers are changed;
ticks, flags, notes, due dates and status are left alone. Missing papers are created.
Reload the planner page afterwards.
"""
from planner_data import load, save

PREP = "Before start of year (STEMbridge, online only)"

# (courseId, paper number label, words the existing title must contain, new title, issued, solutions, lecturer)
ROTA = [
    ("mech",   "Prep sheet",       "",              None,                               "",           "2026-10-07", "Butlin"),
    ("mat",    "Prep sheet",       "",              None,                               "",           "2026-10-07", "Markaki"),
    ("elec",   "Prep sheet",       "",              None,                               "",           "2026-10-07", "Wilkinson"),
    ("maths",  "Prep sheet",       "",              None,                               "",           "2026-10-07", "Savory"),
    ("maths",  "Examples Paper 1", "math",          "Mathematics",                      "2026-10-07", "2026-11-04", "Lasenby"),
    ("mech",   "Examples Paper 1", "mechanics",     "Mechanics",                        "2026-10-07", "2026-11-04", "Butlin"),
    ("elec",   "Examples Paper 1", "physical",      "Physical Principles of Electronics", "2026-10-07", "2026-11-04", "Wilkinson"),
    ("px",     "Examples Paper 1", "dimensional",   "Dimensional Analysis",             "2026-10-07", "2026-11-18", "Kateris/Long"),
    ("struct", "Examples Paper 1", "structural",    "Structural Mechanics",             "2026-10-16", "2026-11-11", "Allwood"),
    ("mech",   "Examples Paper 2", "mechanics",     "Mechanics",                        "2026-10-21", "2026-11-18", "Butlin"),
    ("elec",   "Examples Paper 1", "circuits",      "Analysis of Circuits and Devices", "2026-10-21", "2026-11-18", "Wilkinson"),
    ("maths",  "Examples Paper 2", "math",          "Mathematics",                      "2026-10-21", "2026-11-18", "Savory"),
    ("struct", "Examples Paper 2", "structural",    "Structural Mechanics",             "2026-11-04", "2026-11-25", "Allwood"),
    ("mech",   "Examples Paper 3", "mechanics",     "Mechanics",                        "2026-11-04", "2026-11-25", "Biggins"),
    ("maths",  "Examples Paper 3", "math",          "Mathematics",                      "2026-11-04", "2026-12-02", "Savory"),
    ("elec",   "Examples Paper 2", "circuits",      "Analysis of Circuits and Devices", "2026-11-04", "2026-12-02", "Wilkinson"),
    ("maths",  "Examples Paper 1", "comput",        "Computing",                        "2026-11-11", "2027-01-27", "Mancini"),
    ("struct", "Examples Paper 3", "structural",    "Structural Mechanics",             "2026-11-13", "2027-01-27", "Allwood"),
    ("mech",   "Examples Paper 4", "mechanics",     "Mechanics",                        "2026-11-18", "2027-01-27", "Biggins"),
    ("elec",   "Examples Paper 3", "circuits",      "Analysis of Circuits and Devices", "2026-11-18", "2027-01-27", "Wilkinson"),
    ("maths",  "Examples Paper 4", "math",          "Mathematics",                      "2026-11-18", "2027-01-27", "Lasenby"),
    ("mat",    "Examples Paper 2", "materials",     "Materials (Guided Learning Unit, Moodle only)", "2026-12-02", "2026-12-04", "Seita"),
]


def main():
    data = load()
    used, report = set(), []
    for cid, num, word, title, issued, sols, lecturer in ROTA:
        cands = [p for p in data["papers"] if p["id"] not in used and p.get("courseId") == cid
                 and p.get("number") == num and word in (p.get("title") or "").lower()]
        if cands:
            p = cands[0]
        else:
            p = {"id": f"rota-{cid}-{num.replace(' ', '')}-{word or 'prep'}", "courseId": cid, "number": num,
                 "title": title or "", "due": "", "status": "todo", "notes": "", "total": 10, "done": 0}
            data["papers"].append(p)
            report.append(f"  + created {num} {title}")
        used.add(p["id"])
        if title:
            p["title"] = title
        p["issued"] = issued
        p["issuedNote"] = PREP if not issued else ""
        p["solutions"] = sols
        p["lecturer"] = lecturer
        report.append(f"  {cid:6} {num:17} {p['title'][:40]:41} issued {issued or 'pre-term':10}  solutions {sols}")
    save(data)
    print(f"Applied rota to {len(used)} papers:")
    print("\n".join(report))


if __name__ == "__main__":
    main()
