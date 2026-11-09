"""
Step 1: pull raw NBA game logs and save them to CSV.

Run this on your laptop (stats.nba.com blocks a lot of cloud IPs):
    python src/pull_data.py

What it pulls, per season (regular season only):
  - player game logs: one row per player per game (MIN, FGA, 3PA, FTA, PTS, ...)
  - team game logs:   one row per team per game (used later for opponent
                      defense, pace, and points allowed, all computed from
                      games BEFORE the one we predict, so no leakage)

That's 2 API calls per season, so the whole thing takes under a minute.
Files already on disk are skipped, so it's safe to re-run if it dies halfway.
Use --refresh to re-pull the current season (it changes every night).
"""

import argparse
import time
from pathlib import Path

import pandas as pd
from nba_api.stats.endpoints import leaguegamelog

# 2017-18 = history only (feeds last-season averages + matchup history, not in features.csv)
# 2018-19 to 2025-26 = train/test (default: train 2023-24 + 2024-25, test 2025-26;
#   older seasons are there for the 3 / 5 / 8 season training-window comparison)
# 2026-27 = current season (for the live site)
SEASONS = ["2017-18", "2018-19", "2019-20", "2020-21", "2021-22",
           "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
CURRENT_SEASON = "2026-27"

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
DELAY_SECONDS = 2.0   # pause between calls so stats.nba.com doesn't throttle us
MAX_TRIES = 4


def fetch_game_log(season: str, kind: str) -> pd.DataFrame:
    """kind = 'P' for player logs, 'T' for team logs. Retries with backoff."""
    for attempt in range(1, MAX_TRIES + 1):
        try:
            resp = leaguegamelog.LeagueGameLog(
                season=season,
                player_or_team_abbreviation=kind,
                season_type_all_star="Regular Season",
                timeout=60,
            )
            return resp.get_data_frames()[0]
        except Exception as e:  # timeouts and connection resets are common
            wait = DELAY_SECONDS * 2 ** attempt
            print(f"   attempt {attempt} failed ({type(e).__name__}: {e}); retrying in {wait:.0f}s")
            time.sleep(wait)
    raise RuntimeError(f"Gave up on {season} {kind} after {MAX_TRIES} tries")


def main(refresh: bool) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    for season in SEASONS:
        for kind, label in [("P", "player"), ("T", "team")]:
            out = RAW_DIR / f"{label}_logs_{season}.csv"
            if out.exists() and not (refresh and season == CURRENT_SEASON):
                print(f"skip  {out.name} (already have it)")
                continue

            print(f"pull  {label} logs {season} ...")
            df = fetch_game_log(season, kind)
            df.to_csv(out, index=False)
            print(f"   saved {len(df):,} rows -> {out.name}")
            time.sleep(DELAY_SECONDS)

    # quick sanity check so you know the pull actually worked
    print("\nSummary")
    for season in SEASONS:
        p = pd.read_csv(RAW_DIR / f"player_logs_{season}.csv")
        t = pd.read_csv(RAW_DIR / f"team_logs_{season}.csv")
        print(
            f"  {season}: {len(p):>6,} player rows | {p['PLAYER_ID'].nunique():>3} players | "
            f"{t['GAME_ID'].nunique():>4} games | "
            f"{p['GAME_DATE'].min()} to {p['GAME_DATE'].max()}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true",
                        help="re-pull the current season even if the CSV exists")
    main(parser.parse_args().refresh)
