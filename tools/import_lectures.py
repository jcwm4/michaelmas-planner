#!/usr/bin/env python3
"""Add the Part IA Michaelmas 2026 lectures (from 'Michaelmas 2026-27 v.7a.pdf').

Usage:  python3 tools/import_lectures.py
Re-running replaces previously imported lectures only. Reload the planner page afterwards.

Weeks are term weeks (Thu-Wed), as in the PDF. Times follow the PDF note:
1st lecture 09:00-09:50, 2nd 10:00-10:50, 3rd 11:05-11:55, 4th 12:05-12:55.
"""
from planner_data import load, replace_source, save

SOURCE = "lectures-v7a"
P1, P2, P3, P4 = ("09:00", "09:50"), ("10:00", "10:50"), ("11:05", "11:55"), ("12:05", "12:55")
LT = "Constance Tipper LT"
MON, TUE, WED, THU, FRI = 1, 2, 3, 4, 5

# Moodle course pages (from "Untitled document.docx")
V = "https://www.vle.cam.ac.uk/course/view.php?id="
LINKS = {
    "1P1 Mechanics": V + "69861",
    "1P2 Structures": V + "69831",
    "1P3 Analysis of Circuits": V + "69801",
    "1P3 Physical Principles of Electronics": V + "69811",
    "1P4 Mathematical Methods": V + "69781",
    "1PX Engineering Applications": V + "209921",
    "1CW Integrated Electrical Project intro + Industrial Experience intro": V + "69691",   # IEP
    "1PX Engineer in Society": V + "69751",
    "1P4 Computing": V + "69711",
    "1PX Dimensional Analysis": V + "69761",
    "Industrial Experience Workshop": V + "135162",
    "Drawing: CAD": V + "202401",
}

# (day, slot, title, weeks, lecturer, course, location, type)
LECTURES = [
    # Thursday
    (THU, P1, "1P3 Physical Principles of Electronics", "1-3", "Wilkinson", "elec", LT, "lecture"),
    (THU, P1, "1P3 Analysis of Circuits", "4-8", "Wilkinson", "elec", LT, "lecture"),
    (THU, P2, "1P4 Computing", "1", "Mancini", "maths", LT, "lecture"),
    (THU, P2, "1PX Dimensional Analysis", "2-5", "Kateris", "px", LT, "lecture"),
    (THU, P2, "1PX Engineering Applications", "6-8", "Long et al.", "px", LT, "lecture"),
    # Friday
    (FRI, P3, "1P4 Mathematical Methods", "1-2,7-8", "Lasenby", "maths", LT, "lecture"),
    (FRI, P3, "1P4 Mathematical Methods", "3-6", "Savory", "maths", LT, "lecture"),
    (FRI, P4, "Drawing: CAD", "1", "Roebuck", "labs", LT, "lecture"),
    (FRI, P4, "1P2 Structures", "2-7", "Allwood", "struct", LT, "lecture"),
    # Monday
    (MON, P3, "1P4 Mathematical Methods", "1-2,7-8", "Lasenby", "maths", LT, "lecture"),
    (MON, P3, "1P4 Mathematical Methods", "3-6", "Savory", "maths", LT, "lecture"),
    (MON, P4, "1P1 Mechanics", "1-8", "Biggins / Butlin", "mech", LT, "lecture"),
    # Tuesday
    (TUE, P1, "1PX Engineer in Society", "1-8", "Minshall et al.", "px", LT, "lecture"),
    (TUE, P2, "1P1 Mechanics", "1-8", "Biggins / Butlin", "mech", LT, "lecture"),
    # Wednesday
    (WED, P1, "1P3 Physical Principles of Electronics", "1-3", "Wilkinson", "elec", LT, "lecture"),
    (WED, P1, "1P3 Analysis of Circuits", "4-8", "Wilkinson", "elec", LT, "lecture"),
    (WED, P2, "1CW Integrated Electrical Project intro + Industrial Experience intro", "1", "Wilkinson / Goddard", "labs", LT, "lecture"),
    (WED, P2, "1P2 Structures", "2-7", "Allwood", "struct", LT, "lecture"),
    (WED, P3, "Industrial Experience Workshop", "2-4,6", "Goddard", "labs", "Room 2", "other"),
]


def main():
    data = load()
    events = []
    for i, (day, (start, end), title, weeks, who, course, loc, typ) in enumerate(LECTURES):
        events.append({
            "id": f"lec-{i}", "title": title, "type": typ, "courseId": course,
            "repeat": "weekly", "day": day, "weeks": weeks, "date": "",
            "start": start, "end": end, "location": loc, "who": who, "notes": "", "link": LINKS.get(title, ""),
            "source": SOURCE,
        })
    replace_source(data, SOURCE, events)
    save(data)
    print(f"Imported {len(events)} weekly lecture slots.")


if __name__ == "__main__":
    main()
