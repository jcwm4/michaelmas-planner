#!/bin/zsh
# Double-click to upload new/changed files from ~/Documents/IA Engineering to the planner.
cd "$(dirname "$0")"
python3 tools/sync_library.py
echo
read -k1 "?Done — press any key to close."
