#!/bin/bash
# Morning data update, run by launchd (install with scripts/install_daily_refresh.sh).
# Also fine to run by hand: ./scripts/daily_refresh.sh   (add --force to run again the same day)
#
#   1. back up data/site/ and this season's raw logs to backups/<date>/ (keeps 30 days)
#   2. ./refresh.sh: pull new games, rebuild features + data/site/, match test
#   3. sanity check: stats-through date didn't go backwards
#   4. commit data/site/ and push main -> Render + Vercel redeploy with the new stats
#
# If any step fails, data/site/ is put back from the backup, nothing is pushed,
# and a Mac notification says so. launchd tries again at the next scheduled time.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

TODAY="$(date +%F)"
mkdir -p logs backups
LOG="logs/refresh-$TODAY.log"
exec >>"$LOG" 2>&1
echo
echo "===== $(date '+%F %T') daily refresh ====="

notify() {  # notify "message"
    osascript -e "display notification \"$1\" with title \"NBA Points refresh\"" >/dev/null 2>&1 || true
}
fail() {
    echo "FAILED: $1"
    notify "Failed: $1. Log: $LOG"
    exit 1
}

# one run at a time, and only one successful run per day (launchd fires several times)
if ! mkdir .refresh.lock 2>/dev/null; then echo "another refresh is running, skipping"; exit 0; fi
trap 'rmdir .refresh.lock 2>/dev/null' EXIT
if [ "${1:-}" != "--force" ] && [ "$(cat logs/.last_success 2>/dev/null)" = "$TODAY" ]; then
    echo "already refreshed today, skipping"; exit 0
fi

# only push data commits from main (the live site deploys from main)
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || fail "repo is on branch '$BRANCH', not main"
git pull --ff-only --quiet origin main || echo "warning: git pull failed, continuing"

# 1. backup
SEASON="$(python3 -c 'import json;print(json.load(open("data/site/meta.json"))["season"])')"
OLD_THROUGH="$(python3 -c 'import json;print(json.load(open("data/site/meta.json"))["stats_through"])')"
BK="backups/$(date +%F_%H%M%S)"   # one folder per run, so a second run never nests into the first
mkdir -p "$BK/raw"
cp -R data/site "$BK/site"
cp data/raw/*_"$SEASON".csv "$BK/raw/"
find backups -maxdepth 1 -type d -name '20*' -mtime +30 -exec rm -rf {} +
echo "backed up to $BK (stats through $OLD_THROUGH)"

restore() {
    echo "restoring data/site from $BK"
    rm -rf data/site && cp -R "$BK/site" data/site
}

# 2. refresh
if ! ./refresh.sh; then
    restore
    fail "refresh.sh stopped (stats.nba.com down or the match test failed)"
fi

# 3. sanity check
NEW_THROUGH="$(python3 -c 'import json;print(json.load(open("data/site/meta.json"))["stats_through"])')"
if [[ "$NEW_THROUGH" < "$OLD_THROUGH" ]]; then
    restore
    fail "stats-through went backwards ($OLD_THROUGH -> $NEW_THROUGH)"
fi
echo "stats through: $OLD_THROUGH -> $NEW_THROUGH"

# 4. commit + push (only data/site, even if other files have edits)
git add data/site
if git diff --cached --quiet -- data/site; then
    echo "no data changes to commit"
else
    git commit --quiet -m "Daily data refresh: stats through $NEW_THROUGH" -- data/site \
        || fail "git commit failed"
    git push --quiet origin main || fail "git push failed (data refreshed locally, not live yet)"
    echo "pushed"
fi

echo "$TODAY" > logs/.last_success
find logs -name 'refresh-*.log' -mtime +30 -delete
echo "done $(date '+%T')"
notify "Stats through $NEW_THROUGH, pushed to the site."
