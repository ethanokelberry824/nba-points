"""
Sanity checks for the feature table.

    python src/check_features.py

1. Leak test: delete every game after CUTOFF from the raw logs, rebuild, and
   confirm every feature for games before CUTOFF is identical to the full build.
   If any feature peeked at the future, deleting the future would change it.
2. Hand check: recompute tsa_l5, ts_hot and pts_vs_opp_rel for one player-game
   straight from the raw logs with plain loops (no shared code with
   build_features.py) and compare.
3. Hand check (version 2): recompute team_missing_min / team_missing_tsa and
   opp_missing_min / opp_missing_tsa for the same game the same way.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_features import FEATURES, MIN_GAME_MINUTES, SEASONS, SHRINK_N, build, load_logs

CUTOFF = pd.Timestamp("2025-01-15")
CHECK_PLAYER = "Jayson Tatum"
CHECK_DATE = "2025-02-12"


def leak_test(players, teams, full):
    cut = build(players[players["GAME_DATE"] <= CUTOFF], teams[teams["GAME_DATE"] <= CUTOFF])
    keys = ["GAME_ID", "PLAYER_ID"]
    a = full[full["GAME_DATE"] < CUTOFF].set_index(keys).sort_index()
    b = cut[cut["GAME_DATE"] < CUTOFF].set_index(keys).sort_index()

    print(f"LEAK TEST: raw data cut after {CUTOFF.date()}")
    print(f"  rows before cutoff: full build {len(a):,} | cut build {len(b):,} | "
          f"same rows: {a.index.equals(b.index)}")
    worst = 0.0
    bad = []
    for col in FEATURES:
        x, y = a[col].to_numpy(float), b[col].to_numpy(float)
        same = np.array_equal(x, y, equal_nan=True)
        diff = np.nanmax(np.abs(x - y)) if not same else 0.0
        worst = max(worst, diff)
        if not same:
            bad.append((col, diff))
    if bad:
        for col, d in bad:
            print(f"  DIFFERENT: {col} (max diff {d:.3g})")
    print(f"  features compared: {len(FEATURES)} | identical: {len(FEATURES) - len(bad)} | "
          f"max abs difference: {worst:.3g}")
    print("  PASS" if not bad and a.index.equals(b.index) else "  FAIL")


def hand_check(players, full):
    p = players[players["PLAYER_NAME"] == CHECK_PLAYER].sort_values("GAME_DATE")
    game = p[p["GAME_DATE"] == CHECK_DATE].iloc[0]
    season = game["SEASON"]
    last_season = SEASONS[SEASONS.index(season) - 1]
    opp = game["MATCHUP"][-3:]
    print(f"\nHAND CHECK: {CHECK_PLAYER}, {CHECK_DATE}, {game['MATCHUP']} ({season})")

    def season_games(s, before=None):
        g = p[p["SEASON"] == s]
        return g if before is None else g[g["GAME_DATE"] < before]

    # tsa_l5 and ts_hot
    prior = season_games(season, game["GAME_DATE"])
    last5 = prior.tail(5)
    tsa = lambda g: g["FGA"] + 0.44 * g["FTA"]
    print("  last 5 games: PTS", last5["PTS"].tolist(), "| FGA", last5["FGA"].tolist(),
          "| FTA", last5["FTA"].tolist())
    tsa_l5 = tsa(last5).mean()
    ts_l5 = last5["PTS"].sum() / (2 * tsa(last5).sum())
    ts_season = prior["PTS"].sum() / (2 * tsa(prior).sum())
    n = len(last5)
    ts_hot = (ts_l5 - ts_season) * n / (n + SHRINK_N)
    print(f"  tsa_l5 = mean(FGA + 0.44*FTA) = {tsa_l5:.4f}")
    print(f"  ts_l5 = {ts_l5:.4f}, ts_season = {ts_season:.4f} ({len(prior)} games)")
    print(f"  ts_hot = ({ts_l5:.4f} - {ts_season:.4f}) * {n}/{n + SHRINK_N} = {ts_hot:.4f}")

    # pts_vs_opp_rel: earlier meetings vs this opponent, this season + last season
    rels = []
    for s in [last_season, season]:
        g = season_games(s)
        for i, (_, row) in enumerate(g.iterrows()):
            if row["GAME_DATE"] >= game["GAME_DATE"] or not row["MATCHUP"].endswith(opp):
                continue
            if row["MIN"] < MIN_GAME_MINUTES:
                continue
            if i > 0:
                avg = g.iloc[:i]["PTS"].mean()
            else:
                prev_s = SEASONS[SEASONS.index(s) - 1]
                avg = season_games(prev_s)["PTS"].mean()
            rels.append(row["PTS"] - avg)
            print(f"  meeting {row['GAME_DATE'].date()} {row['MATCHUP']}: PTS {row['PTS']}, "
                  f"avg going in {avg:.2f}, rel {row['PTS'] - avg:+.2f}")
    m = len(rels)
    rel = (np.mean(rels) * m / (m + SHRINK_N)) if m else 0.0
    print(f"  pts_vs_opp_rel = mean(rel) * {m}/{m + SHRINK_N} = {rel:.4f}")

    row = full[(full["PLAYER_NAME"] == CHECK_PLAYER) & (full["GAME_DATE"] == CHECK_DATE)].iloc[0]
    print("\n  feature      by hand    features.csv")
    ok = True
    for name, val in [("tsa_l5", tsa_l5), ("ts_hot", ts_hot), ("pts_vs_opp_rel", rel)]:
        match = np.isclose(val, row[name])
        ok &= match
        print(f"  {name:<14} {val:>8.4f}   {row[name]:>8.4f}   {'ok' if match else 'MISMATCH'}")
    print("  PASS" if ok else "  FAIL")


def missing_by_hand(players, team, game_id, season):
    """Usual minutes + usual shots of `team`'s rotation players who sat out game_id.

    Plain loops over the raw logs: the team's games in order, then for each player who
    played in one of the 10 team games before tonight, his season averages through
    his most recent of those games (any team this season counts toward the average).
    """
    t_games = (players[(players["TEAM_ID"] == team) & (players["SEASON"] == season)]
               .drop_duplicates("GAME_ID").sort_values("GAME_DATE")["GAME_ID"].tolist())
    k = t_games.index(game_id)
    window = t_games[max(0, k - 10):k]
    tonight = set(players[(players["GAME_ID"] == game_id) & (players["TEAM_ID"] == team)]["PLAYER_ID"])
    rows = []
    for pid in players[(players["TEAM_ID"] == team) & players["GAME_ID"].isin(window)]["PLAYER_ID"].unique():
        if pid in tonight:
            continue
        mine = players[(players["PLAYER_ID"] == pid) & (players["SEASON"] == season)].sort_values("GAME_DATE")
        last = [g for g in window if g in set(mine[mine["TEAM_ID"] == team]["GAME_ID"])][-1]
        thru = mine.iloc[:list(mine["GAME_ID"]).index(last) + 1]
        avg_min = thru["MIN"].mean()
        avg_tsa = (thru["FGA"] + 0.44 * thru["FTA"]).mean()
        if avg_min >= 15:
            rows.append((thru["PLAYER_NAME"].iloc[-1], avg_min, avg_tsa))
    return rows


def hand_check_missing(players, full):
    game = players[(players["PLAYER_NAME"] == CHECK_PLAYER) & (players["GAME_DATE"] == CHECK_DATE)].iloc[0]
    row = full[(full["PLAYER_NAME"] == CHECK_PLAYER) & (full["GAME_DATE"] == CHECK_DATE)].iloc[0]
    print(f"\nHAND CHECK (version 2): players out, {CHECK_PLAYER}, {CHECK_DATE}")
    ok = True
    for side, team in [("team", row["TEAM_ID"]), ("opp", row["OPP_TEAM_ID"])]:
        out = missing_by_hand(players, team, game["GAME_ID"], game["SEASON"])
        for name, m, t in out:
            print(f"  {side} out: {name:<24} usual {m:5.1f} min, {t:5.1f} shots")
        mins, shots = sum(m for _, m, _ in out), sum(t for _, _, t in out)
        for feat, val in [(f"{side}_missing_min", mins), (f"{side}_missing_tsa", shots)]:
            match = np.isclose(val, row[feat])
            ok &= match
            print(f"  {feat:<17} {val:>8.4f}   {row[feat]:>8.4f}   {'ok' if match else 'MISMATCH'}")
    print("  PASS" if ok else "  FAIL")


def main():
    players = load_logs("player")
    teams = load_logs("team")
    full = build(players, teams)
    leak_test(players, teams, full)
    hand_check(players, full)
    hand_check_missing(players, full)


if __name__ == "__main__":
    main()
