#!/bin/bash
# Installs (or reinstalls) the morning refresh as a macOS launchd job.
#   ./scripts/install_daily_refresh.sh            install / update
#   ./scripts/install_daily_refresh.sh --remove   uninstall
#
# Runs scripts/daily_refresh.sh at 7:00, 10:00 and 13:00 every day, plus at login.
# The first run that succeeds each day does the work; later ones skip.
# If the laptop is asleep at 7:00, launchd runs the job when it wakes up.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.nbapoints.daily-refresh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
    rm -f "$PLIST"; echo "removed $LABEL"; exit 0
fi

chmod +x "$ROOT/scripts/daily_refresh.sh" "$ROOT/refresh.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array><string>/bin/bash</string><string>$ROOT/scripts/daily_refresh.sh</string></array>
    <key>WorkingDirectory</key><string>$ROOT</string>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>0</integer></dict>
    </array>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>$ROOT/logs/launchd.log</string>
    <key>StandardErrorPath</key><string>$ROOT/logs/launchd.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL -> $PLIST"
echo "logs: $ROOT/logs/"
