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
