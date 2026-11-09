"""
Match test for the site's feature code.

    python src/check_pregame.py

Picks 25 random real games from 2025-26 and 2026-27 in features.csv and rebuilds
each one with pregame_features() as if it were the night before: the actual
date, home/away, opponent, and the players who actually sat out (anyone who
played for the team earlier this season but isn't in that game's box score).
Every one of the 33 features has to match features.csv.

The 2026-27 games are also checked against the trimmed site files in data/site/
(if they exist), so we know the app's data is complete too.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_features import FEATURES, ID_COLS, load_logs  # noqa: E402
from pregame import SITE_DIR, load_site_logs, pregame_features  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
N_GAMES = {"2025-26": 15, "2026-27": 10}
SEED = 42
TOL = 1e-9


def sat_out(players, team_id, season, game_date, game_id):
    """Players who played for this team earlier this season but aren't in this game's box score."""
    p = players[(players["SEASON"] == season) & (players["TEAM_ID"] == team_id)]
    before = set(p.loc[p["GAME_DATE"] < game_date, "PLAYER_ID"])
    box = set(p.loc[p["GAME_ID"] == game_id, "PLAYER_ID"])
    return sorted(before - box)


def compare(expected, got):
    """Returns (list of mismatched features, max abs difference)."""
    x = expected[FEATURES].to_numpy(float).ravel()
    y = got[FEATURES].iloc[0].to_numpy(float)
    same = np.isclose(x, y, rtol=0, atol=TOL, equal_nan=True)
    diff = np.nan_to_num(np.abs(x - y), nan=0.0)
    return [f for f, ok in zip(FEATURES, same) if not ok], diff.max()


def main():
    feats = pd.read_csv(ROOT / "data" / "processed" / "features.csv",
                        usecols=ID_COLS + FEATURES, parse_dates=["GAME_DATE"])
    sample = pd.concat([feats[feats["SEASON"] == s].sample(n, random_state=SEED)
                        for s, n in N_GAMES.items()]).sort_values("GAME_DATE")

    players, teams = load_logs("player"), load_logs("team")
    site = load_site_logs() if (SITE_DIR / "player_logs.csv.gz").exists() else None
    if site is None:
        print("(no data/site files yet, so only the raw logs are checked)")

    print(f"MATCH TEST: {len(sample)} real games, {len(FEATURES)} features each\n")
    print(f"{'date':<11}{'player':<26}{'game':<12}{'out (team/opp)':<16}"
          f"{'team_miss':>10}{'opp_miss':>9}  raw logs   site files")
    results = []
    for _, r in sample.iterrows():
        ids = teams[teams["SEASON"] == r["SEASON"]].drop_duplicates("TEAM_ABBREVIATION") \
            .set_index("TEAM_ABBREVIATION")["TEAM_ID"]
        team_id, opp_id = int(ids[r["TEAM"]]), int(ids[r["OPP"]])
        home = bool(r["HOME"])
        team_out = sat_out(players, team_id, r["SEASON"], r["GAME_DATE"], r["GAME_ID"])
        opp_out = sat_out(players, opp_id, r["SEASON"], r["GAME_DATE"], r["GAME_ID"])
        args = (int(r["PLAYER_ID"]), opp_id, r["GAME_DATE"], home, team_out, opp_out)
        expected = r.to_frame().T

        got = pregame_features(*args, players=players, teams=teams, team_id=team_id)
        bad, worst = compare(expected, got)
        results.append((bad, worst))
        status = "ok" if not bad else f"FAIL {bad}"

        site_status = "-"
        if site is not None and r["SEASON"] == "2026-27":
            got_s = pregame_features(*args, players=site[0], teams=site[1], team_id=team_id)
            bad_s, worst_s = compare(expected, got_s)
            results.append((bad_s, worst_s))
            site_status = "ok" if not bad_s else f"FAIL {bad_s}"

        game = f"{r['TEAM']} {'vs' if home else '@'} {r['OPP']}"
        print(f"{r['GAME_DATE'].date()!s:<11}{r['PLAYER_NAME'][:25]:<26}{game:<12}"
              f"{f'{len(team_out)}/{len(opp_out)}':<16}{got['team_missing_min'].iloc[0]:>10.1f}"
              f"{got['opp_missing_min'].iloc[0]:>9.1f}  {status:<10} {site_status}")

    n_fail = sum(bool(b) for b, _ in results)
    worst = max(w for _, w in results)
    print(f"\nchecks run: {len(results)} | failed: {n_fail} | "
          f"max abs difference over all features: {worst:.3g}")
    print("PASS" if n_fail == 0 else "FAIL")
    sys.exit(0 if n_fail == 0 else 1)


if __name__ == "__main__":
    main()
