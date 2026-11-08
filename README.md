# Michaelmas Planner

A personal term planner for Cambridge Part IA Engineering: timetable, supervisions,
examples papers (with per-question ticking and flags), labs and tasks. Selwyn-themed.

## How it works

- **This repo (public)** holds only the app code in `public/`, deployed to GitHub Pages
  by `.github/workflows/pages.yml`. It contains **no personal data**.
- **Your data** lives in a separate **private** repo as `planner.json`. The app reads and
  saves it through the GitHub API using a fine-grained access token that you paste in once
  per device. The token is stored only in that browser and only ever sent to `api.github.com`.
- Each device keeps an offline copy; changes sync when you're back online, and if two devices
  edit at the same time you're asked which version to keep.

## Access token

GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:
- Repository access: **Only select repositories** → your private data repo
- Repository permissions: **Contents → Read and write** (nothing else)

## Import scripts (optional, run on a Mac)

Clone your private data repo into `data/` (it is git-ignored here). The scripts in `tools/`
pull the latest data, update it, then commit and push back to the private repo:

```
python3 tools/import_labs.py 16-18
python3 tools/import_lectures.py
python3 tools/import_supervisions.py path/to/supervisions.xlsx --group N
python3 tools/import_paper_rota.py
```

`python3 server.py` still runs a local copy at http://localhost:8000 if you ever need it.

## PDFs: examples papers, data books, lecture handouts

PDFs are kept in the **private** data repo (`papers/`), never in this public repo.
They're viewed in the app with a bundled copy of [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0, `public/vendor/pdfjs/`).

- Add/refresh everything (examples papers, data books, lecture handouts) from
  `~/Documents/IA Engineering`: double-click **Sync IA Engineering.command**, or run
  `python3 tools/sync_library.py` (`--dry-run` to preview). Only new or changed files are
  uploaded; files deleted from Data Books / Lecture Handouts are removed from the planner.
- Or attach one in the app: ✎ Edit on a paper → 📎 Attach PDF.

## Search

The 🔍 Search tab (or press `/`) searches papers, tasks, the timetable, notes, handouts and
data books, and the text inside every PDF. The PDF text is pulled out on your Mac with the
built-in PDFKit when you sync (`tools/build_search.py`, run automatically by the sync) and
stored as `search/index.json` in the **private** data repo. PDFs attached from the app itself
are searchable after the next sync.

## Emails

The private data repo sends a daily digest at 6am UK time (`daily-digest.yml`) and a
"week ahead" email on Sundays at 6pm (`weekly-digest.yml`), both from `digest.py`.

## Phone notifications

Settings → Notifications → **Turn on** (on iPhone, add the planner to your Home Screen first).
Each device's push subscription is saved in the private data repo; `notify.yml` there sends a
07:30 "today" and a 19:00 "tomorrow" reminder via `notify.py`. It needs the repo secret
`VAPID_PRIVATE_KEY` (the matching public key is `VAPID_PUBLIC` in `public/app.js`).

## Automatic sync

`zsh tools/install_auto_sync.sh` installs a per-user launchd agent that runs
`tools/auto_sync.sh` whenever `~/Documents/IA Engineering` changes (and every 15 minutes).
It only syncs when a PDF was added, changed or removed, and shows a Mac notification.
`zsh tools/install_auto_sync.sh --remove` turns it off. Log: `~/Library/Logs/Michaelmas Planner sync.log`.
