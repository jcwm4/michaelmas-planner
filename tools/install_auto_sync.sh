#!/bin/zsh
# Turn automatic syncing of ~/Documents/IA Engineering on (or off with --remove).
# Installs a per-user launchd agent; nothing runs as root.
LABEL="io.github.jcwm4.planner-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="${0:A:h:h}"
ROOT="$HOME/Documents/IA Engineering"

APP="$HOME/Applications/Planner Sync.app"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
if [ "$1" = "--remove" ]; then
  rm -f "$PLIST"; rm -rf "$APP"; echo "Automatic sync turned off."; exit 0
fi

# macOS only lets a background job read ~/Documents if it's an app you've allowed, so the
# job runs inside a tiny invisible app ("Planner Sync") that asks for that once.
mkdir -p "$HOME/Applications"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"/bin/zsh \" & quoted form of \"$REPO/tools/auto_sync.sh\"" || exit 1
plutil -replace LSUIElement -bool true "$APP/Contents/Info.plist"              # no Dock icon
plutil -replace CFBundleIdentifier -string "$LABEL" "$APP/Contents/Info.plist"
plutil -replace NSAppleEventsUsageDescription -string "Shows a notification when your planner files sync." "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" 2>/dev/null

# watch the top folder and each course folder (launchd doesn't watch sub-folders itself);
# the 15-minute backstop catches anything else, e.g. new course folders
watch=""
for d in "$ROOT" "$ROOT"/*(N/) "$ROOT"/*/*(N/); do
  watch+="    <string>${d//&/&amp;}</string>\n"
done

mkdir -p "$HOME/Library/LaunchAgents"
print -r -- "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$APP/Contents/MacOS/applet</string></array>
  <key>WatchPaths</key>
  <array>
$(print -n -- "$watch")  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
</dict>
</plist>" > "$PLIST"
plutil -lint "$PLIST" >/dev/null || { echo "Bad plist"; exit 1; }
rm -f "$HOME/Library/Application Support/Michaelmas Planner/fingerprint"   # sync once now
launchctl bootstrap "gui/$(id -u)" "$PLIST" || exit 1
echo "Automatic sync is on. If macOS asks whether \"Planner Sync\" can access your Documents folder, click Allow."
echo "Log: ~/Library/Logs/Michaelmas Planner sync.log"
