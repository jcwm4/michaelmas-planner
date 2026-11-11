#!/bin/zsh
# Once a day, fetch the live Selwyn supervision sheet through your logged-in Chrome (SharePoint
# needs your Cambridge login, which only the browser has), compare it with the planner and apply
# any changes. Called from auto_sync.sh, which the Planner Sync helper runs every 15 minutes.
#
# - Only after 07:00, only while Chrome is already open, at most one try an hour.
# - Small changes are applied and shown as a Mac notification; big ones (lots of supervisions
#   disappearing, e.g. the sheet's layout changed) are NOT applied - you get a notification instead.
# - The sheet link lives in your private data repo (data/sources.json).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
REPO="${0:A:h:h}"
STATE="$HOME/Library/Application Support/Michaelmas Planner"
LOG="$HOME/Library/Logs/Michaelmas Planner sync.log"
DL="$HOME/Downloads"
mkdir -p "$STATE"
today=$(date +%F)
notify() { osascript -e "display notification \"$2\" with title \"Michaelmas Planner\" subtitle \"$1\"" >/dev/null 2>&1; }
log() { echo "$(date '+%F %T') supervisions: $*" >> "$LOG"; }

[ "$(cat "$STATE/sup-checked" 2>/dev/null)" = "$today" ] && exit 0      # done today
[ "$(date +%H)" -lt 7 ] && exit 0
pgrep -xq "Google Chrome" || exit 0                                       # don't launch Chrome
last=$(cat "$STATE/sup-attempt" 2>/dev/null || echo 0)
[ $(( $(date +%s) - last )) -lt 3600 ] && exit 0                          # one try an hour
date +%s > "$STATE/sup-attempt"

url=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['supervisionSheet']['url'])" "$REPO/data/sources.json" 2>/dev/null)
[ -n "$url" ] || { log "no sheet link in data/sources.json"; exit 0; }

touch "$STATE/sup-marker"
open -g -a "Google Chrome" "$url?download=1"
file=""
for i in {1..30}; do
  sleep 2
  file=$(find "$DL" -maxdepth 1 -name 'Michaelmas_Supervisions*.xlsx' -newer "$STATE/sup-marker" 2>/dev/null | head -1)
  [ -n "$file" ] && ! ls "$DL"/*.crdownload >/dev/null 2>&1 && break
  file=""
done

if [ -z "$file" ]; then
  fails=$(( $(grep -c "^$today" "$STATE/sup-fails" 2>/dev/null) + 1 )); echo "$today" >> "$STATE/sup-fails"
  log "couldn't download the sheet (try $fails today) - logged out of SharePoint in Chrome, or no access to Downloads?"
  [ "$fails" -eq 3 ] && notify "Supervision check" "Couldn't open the supervision sheet. Log in to SharePoint in Chrome."
  exit 0
fi

preview=$(cd "$REPO" && python3 tools/import_supervisions.py "$file" --dry-run 2>&1); code=$?
if [ $code -ne 0 ]; then
  log "couldn't read the sheet:"; echo "$preview" | tail -5 >> "$LOG"
  notify "Supervision check" "The supervision sheet couldn't be read. Ask Claude to check it."
  rm -f "$file"; echo "$today" > "$STATE/sup-checked"; exit 0
fi
changes=$(print -r -- "$preview" | grep -E '^\s+[-+~] ')
if [ -z "$changes" ]; then
  log "no changes"
  rm -f "$file"; echo "$today" > "$STATE/sup-checked"; exit 0
fi

removed=$(print -r -- "$changes" | grep -c '^\s*- removed')
if [ "$removed" -gt 4 ]; then
  log "NOT applied - $removed supervisions would disappear:"; echo "$changes" >> "$LOG"
  notify "Supervision sheet changed a lot" "$removed supervisions would be removed, so nothing was changed. Ask Claude to check it."
  rm -f "$file"; echo "$today" > "$STATE/sup-checked"; exit 0
fi

{ echo "=== $(date '+%F %T') supervision sheet changed:"; echo "$changes"; } >> "$LOG"
if (cd "$REPO" && python3 tools/import_supervisions.py "$file" >> "$LOG" 2>&1); then
  first=$(print -r -- "$changes" | grep -E 'new|changed|due date' | head -1 | sed -E 's/^ *[-+~] *(new|changed|due date) *//; s/"//g' | cut -c1-90)
  n=$(print -r -- "$changes" | grep -cE '^\s+[+~] ')
  notify "Supervisions updated ($n change$([ $n -eq 1 ] || echo s))" "${first:-See the planner}"
  echo "$today" > "$STATE/sup-checked"
else
  notify "Supervision check" "Updating the planner failed. See the log in ~/Library/Logs."
fi
rm -f "$file"
