#!/bin/zsh
# Run by launchd (see install_auto_sync.sh) when ~/Documents/IA Engineering changes, and every
# 15 minutes as a backstop. Does nothing unless a PDF was added, changed, renamed or removed;
# then waits for copying to finish, runs the sync and shows a Mac notification.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
ROOT="$HOME/Documents/IA Engineering"
REPO="${0:A:h:h}"
STATE="$HOME/Library/Application Support/Michaelmas Planner"
LOG="$HOME/Library/Logs/Michaelmas Planner sync.log"
mkdir -p "$STATE"

fingerprint() {   # names, sizes and modified times of every PDF
  find "$ROOT" -iname '*.pdf' -type f -print0 2>/dev/null | xargs -0 stat -f '%N|%z|%m' 2>/dev/null | sort | shasum | cut -c1-40
}

[ -d "$ROOT" ] || exit 0
if ! ls "$ROOT" >/dev/null 2>&1; then
  echo "$(date '+%F %T') can't read $ROOT (macOS privacy permission needed)" >> "$LOG"; exit 0
fi
now=$(fingerprint)
[ "$now" = "$(cat "$STATE/fingerprint" 2>/dev/null)" ] && exit 0

# wait until files stop changing (e.g. a big download still copying)
for i in {1..12}; do
  sleep 10
  again=$(fingerprint)
  [ "$again" = "$now" ] && break
  now=$again
done

{
  echo "=== $(date '+%F %T')"
  out=$(cd "$REPO" && python3 tools/sync_library.py 2>&1)
  code=$?
  echo "$out"
} >> "$LOG" 2>&1

if [ $code -eq 0 ]; then
  echo "$now" > "$STATE/fingerprint"
  n=$(print -r -- "$out" | grep -cE '^\s+[-+~] ')
  if [ "$n" -gt 0 ]; then
    msg="$n file change$([ $n -eq 1 ] || echo s) uploaded to your planner"
    osascript -e "display notification \"$msg\" with title \"Michaelmas Planner\" subtitle \"IA Engineering synced\"" >/dev/null 2>&1
  fi
else
  osascript -e 'display notification "Sync failed — see the log in ~/Library/Logs" with title "Michaelmas Planner"' >/dev/null 2>&1
fi
