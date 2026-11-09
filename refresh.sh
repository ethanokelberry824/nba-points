#!/usr/bin/env bash
# Update the site's data. Run on the laptop (stats.nba.com blocks cloud servers):
#     ./refresh.sh
# Then commit + push data/site/ and the hosted API (and the Streamlit backup) redeploy
# with the new stats.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .venv/bin/activate ] && source .venv/bin/activate

echo "== 1/5 pull the latest games"
python src/pull_data.py --refresh
echo "== 2/5 rebuild features.csv"
python src/build_features.py
echo "== 3/5 write data/site/ (logs, player/team lists, meta, error bands)"
python src/build_site_data.py
echo "== 4/5 model performance page numbers (data/site/model_stats.json, live tracker)"
python src/build_model_stats.py
echo "== 5/5 match test (site features == training features)"
python src/check_pregame.py | tail -2
echo "done. next: git add data/site && git commit -m 'refresh data' && git push"
