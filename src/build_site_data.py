"""
Step 4: write the small data files the Streamlit app reads.

    python src/build_site_data.py        (or just ./refresh.sh)

The hosted app can't reach stats.nba.com, and it shouldn't load the 69 MB
features.csv either. So this trims the raw logs down to what pregame_features()
needs for current-season predictions and saves them to data/site/:

    player_logs.csv.gz  this season for everyone, plus the 2 seasons before for
                        this season's players (last-season averages + matchup history)
    team_logs.csv.gz    this season + last season, every team (opponent strength blends)
    players.csv         dropdown list: each current player, his team, ppg, mpg, games
    teams.csv           team id, abbreviation, full name
    meta.json           "stats through" date + the test-set accuracy numbers the page shows
                        (version 1's pre-committed score, plus version 2's second look)
    error_bands.json    2025-26 test-set misses (actual - predicted) of the model the site
                        uses (version 2) by scoring tier, for the API's "likely range"
                        (middle 60% of misses for players like him)
    def_onoff.csv       context only, NOT a model feature: for each player-team, the team's
                        defensive rating without him minus with him, this season + last
                        (raw and shrunk, plus the "key defender" flag the site shows)

The model performance page's numbers come from src/build_model_stats.py.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_features import FEATURES, SEASONS, load_logs  # noqa: E402
from pregame import PLAYER_COLS, SITE_DIR, TEAM_COLS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CURRENT = SEASONS[-1]
TEST_SEASON = "2025-26"


# scoring tiers by pts_blend (his usual scoring), same cut as the notebook's error breakdown
TIER_EDGES = [-1, 10, 20, 1000]
TIER_LABELS = ["under 10 ppg", "10-20 ppg", "20+ ppg"]
BAND_PCTS = [10, 20, 50, 80, 90]     # the API's "likely range" uses 20th to 80th (middle 60%)


# results/test_results.csv row of each saved final model's blend
BLEND_ROWS = {"v1": "Blend (0.6 HistGB + 0.4 Huber)", "v2": "v2 Blend (0.6 HistGB + 0.4 Huber)"}
FINAL_FILES = {"v1": "final_model_v1.joblib", "v2": "final_model.joblib"}


def test_predictions(version: str) -> pd.DataFrame:
    """The 2025-26 test set with a saved final model's predictions (columns pred, resid).
    version "v1" = models/final_model_v1.joblib (the pre-committed test score),
    "v2" = models/final_model.joblib (what the site uses; a second look at the test set).
    Checks they reproduce that model's test MAE in results/test_results.csv."""
    res = pd.read_csv(ROOT / "results" / "test_results.csv").set_index("approach")
    blend_mae = res.loc[BLEND_ROWS[version], "test_MAE"]
    bundle = joblib.load(ROOT / "models" / FINAL_FILES[version])
    df = pd.read_csv(ROOT / "data" / "processed" / "features.csv",
                     usecols=["SEASON", "PTS"] + FEATURES)
    test = df[df["SEASON"] == TEST_SEASON].copy()
    test["pred"] = bundle["model"].predict(test[bundle["features"]])
    test["resid"] = test["PTS"] - test["pred"]          # + = he scored MORE than predicted
    if not np.isclose(test["resid"].abs().mean(), blend_mae):
        raise RuntimeError(f"{version} final model MAE {test['resid'].abs().mean():.4f} "
                           f"!= test_results.csv {blend_mae:.4f}")
    return test


def error_bands(test: pd.DataFrame) -> dict:
    """How far off the final model was on the 2025-26 test set, by scoring tier.

    resid = actual - predicted. The API's likely range is
    prediction + [20th, 80th percentile of resid] for his tier, so it covers the
    middle 60% of real misses for players who score like him.
    """
    tier = pd.cut(test["pts_blend"], TIER_EDGES, labels=TIER_LABELS, right=False)

    def pct(r):
        out = {f"p{q}": round(float(np.percentile(r, q)), 3) for q in BAND_PCTS}
        out["games"] = int(len(r))
        out["mae"] = round(float(r.abs().mean()), 3)
        return out

    bands = {lab: pct(test.loc[tier == lab, "resid"]) for lab in TIER_LABELS}
    return {
        "test_season": TEST_SEASON,
        "tier_by": "pts_blend",
        "tier_edges": TIER_EDGES[1:-1],      # under 10 | 10 to under 20 | 20+
        "tiers": TIER_LABELS,
        "range_pcts": [20, 80],
        "bands": bands,
        "all": pct(test["resid"]),
    }


def accuracy(test: pd.DataFrame, version: str) -> dict:
    """Test-set numbers for the page: MAE from results/test_results.csv, plus how often
    the final model landed within 3 / 5 points (recomputed from the saved final model)."""
    res = pd.read_csv(ROOT / "results" / "test_results.csv").set_index("approach")
    blend = res.loc[BLEND_ROWS[version]]
    l5 = res.loc["baseline: pts_l5"]
    err = test["resid"].abs()
    return {
        "test_season": TEST_SEASON,
        "test_games": int(len(test)),
        "test_mae": round(float(blend["test_MAE"]), 2),
        "baseline_l5_mae": round(float(l5["test_MAE"]), 2),
        "pct_within_3": round(float(100 * (err <= 3).mean())),
        "pct_within_5": round(float(100 * (err <= 5).mean())),
        "pct_off_10_plus": round(float(100 * (err >= 10).mean())),
    }


# "Key defender" context on the Matchup page (one rule, used by the API and printed below)
KEY_DEF_MIN_WITH = 10       # games he played for the team (this season + last)
KEY_DEF_MIN_WITHOUT = 5     # games the team played without him, after his first game for them
KEY_DEF_SHRINK_K = 10       # shrink toward 0: delta * without / (without + 10), like the model's blends
KEY_DEF_MIN_SHRUNK = 2.0    # show the line only when the shrunk value is at least this


def defense_on_off(players: pd.DataFrame, teams: pd.DataFrame, seasons: list[str]) -> pd.DataFrame:
    """Context for the site, NOT a model feature (it didn't beat noise as one, see
    results/search/v2_experiments/). For each player on each team, over `seasons`
    combined (the site uses this season + last):

        def_delta        = team's defensive rating in games WITHOUT him minus games WITH
                           him (points allowed per 100 possessions, possession-weighted;
                           + = the team defends worse without him). Raw.
        def_delta_shrunk = def_delta * games_without / (games_without + 10): pulled toward 0
                           when he's missed only a few games, like the model's blends
        key_defender     = shown on the site: 10+ games with him, 5+ without, shrunk >= 2

    Same team only (games he played for another team don't count), and "without" only
    counts the team's games after his first game for that team, so a player who joined
    late isn't "missing" the games before he arrived. Logic from
    results/search/v2_experiments/onoff.py, using totals.
    """
    t = teams[teams["SEASON"].isin(seasons)]
    opp = t[["GAME_ID", "TEAM_ID", "PTS", "FGA", "OREB", "TOV", "FTA"]].rename(
        columns=lambda c: c if c == "GAME_ID" else f"O_{c}")
    t = t.merge(opp, on="GAME_ID")
    t = t[t["TEAM_ID"] != t["O_TEAM_ID"]].copy()
    # possessions: same estimate as build_team_features (average of both teams)
    t["POSS"] = ((t["FGA"] - t["OREB"] + t["TOV"] + 0.44 * t["FTA"])
                 + (t["O_FGA"] - t["O_OREB"] + t["O_TOV"] + 0.44 * t["O_FTA"])) / 2
    t = t.sort_values(["TEAM_ID", "GAME_DATE", "GAME_ID"])

    pl = players[players["SEASON"].isin(seasons)][["PLAYER_ID", "TEAM_ID", "GAME_ID"]].assign(on=1)
    rows = []
    for team, g in t.groupby("TEAM_ID"):
        gids = g["GAME_ID"].to_numpy()
        on = (pl[(pl["TEAM_ID"] == team) & pl["GAME_ID"].isin(gids)]
              .pivot_table(index="GAME_ID", columns="PLAYER_ID", values="on", fill_value=0)
              .reindex(gids, fill_value=0))
        m = on.to_numpy(float)
        joined = np.cumsum(m, axis=0) > 0                     # he has played for them by this game
        after_first = np.vstack([np.zeros((1, m.shape[1]), bool), joined[:-1]])
        off = (1 - m) * after_first                           # missed a game after his first one
        poss, allowed = g["POSS"].to_numpy()[:, None], g["O_PTS"].to_numpy()[:, None]
        with np.errstate(divide="ignore", invalid="ignore"):
            rtg_with = 100 * (m * allowed).sum(0) / (m * poss).sum(0)
            rtg_without = 100 * (off * allowed).sum(0) / (off * poss).sum(0)
        rows.append(pd.DataFrame({
            "TEAM_ID": team, "PLAYER_ID": on.columns,
            "games_with": m.sum(0).astype(int), "games_without": off.sum(0).astype(int),
            "def_rtg_with": rtg_with, "def_rtg_without": rtg_without,
        }))
    out = pd.concat(rows, ignore_index=True)
    out["def_delta"] = out["def_rtg_without"] - out["def_rtg_with"]
    out.loc[out["games_without"] == 0, ["def_rtg_without", "def_delta"]] = np.nan
    gw = out["games_without"]
    out["def_delta_shrunk"] = out["def_delta"] * gw / (gw + KEY_DEF_SHRINK_K)
    out["key_defender"] = ((out["games_with"] >= KEY_DEF_MIN_WITH)
                           & (gw >= KEY_DEF_MIN_WITHOUT)
                           & (out["def_delta_shrunk"] >= KEY_DEF_MIN_SHRUNK))
    out["seasons"] = " + ".join(seasons)
    return out.round({"def_rtg_with": 2, "def_rtg_without": 2, "def_delta": 2, "def_delta_shrunk": 2})


def main() -> None:
    players = load_logs("player")
    teams = load_logs("team")
    SITE_DIR.mkdir(parents=True, exist_ok=True)

    # player logs: this season for everyone, 2 seasons back only for this season's players
    cur_ids = players.loc[players["SEASON"] == CURRENT, "PLAYER_ID"].unique()
    older = SEASONS[SEASONS.index(CURRENT) - 2: SEASONS.index(CURRENT)]
    p = players[(players["SEASON"] == CURRENT)
                | (players["SEASON"].isin(older) & players["PLAYER_ID"].isin(cur_ids))]
    p = p[PLAYER_COLS].sort_values(["GAME_DATE", "GAME_ID", "PLAYER_ID"])
    p.to_csv(SITE_DIR / "player_logs.csv.gz", index=False, date_format="%Y-%m-%d")

    t = teams[teams["SEASON"].isin(SEASONS[-2:])][TEAM_COLS].sort_values(["GAME_DATE", "GAME_ID"])
    t.to_csv(SITE_DIR / "team_logs.csv.gz", index=False, date_format="%Y-%m-%d")

    # team list (current season names)
    tl = (teams[teams["SEASON"] == CURRENT].sort_values("GAME_DATE")
          .drop_duplicates("TEAM_ID", keep="last")[["TEAM_ID", "TEAM_ABBREVIATION", "TEAM_NAME"]]
          .rename(columns={"TEAM_ABBREVIATION": "TEAM"}).sort_values("TEAM_NAME"))
    tl.to_csv(SITE_DIR / "teams.csv", index=False)

    # player list: current team = team of his latest game
    cur = players[players["SEASON"] == CURRENT].sort_values("GAME_DATE")
    pl = cur.groupby("PLAYER_ID").agg(PLAYER_NAME=("PLAYER_NAME", "last"),
                                      TEAM_ID=("TEAM_ID", "last"), TEAM=("TEAM_ABBREVIATION", "last"),
                                      games=("PTS", "size"), ppg=("PTS", "mean"),
                                      mpg=("MIN", "mean"), last_game=("GAME_DATE", "last"))
    pl = pl.round({"ppg": 1, "mpg": 1}).reset_index().sort_values("PLAYER_NAME")
    pl.to_csv(SITE_DIR / "players.csv", index=False, date_format="%Y-%m-%d")

    # defense with / without each player, this season + last (context only, not a model feature)
    onoff = defense_on_off(players, teams, SEASONS[-2:])
    onoff.to_csv(SITE_DIR / "def_onoff.csv", index=False)

    # headline accuracy = version 1's pre-committed test score; version 2 (the model the
    # site uses) is a second look at the same test season, shown next to it
    test_v1, test_v2 = test_predictions("v1"), test_predictions("v2")
    meta = {
        "season": CURRENT,
        "stats_through": cur["GAME_DATE"].max().strftime("%Y-%m-%d"),
        "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "model_version": "v2",
        **accuracy(test_v1, "v1"),
        "v2": {**accuracy(test_v2, "v2"),
               "note": "Second look at the 2025-26 test season (it was already used for "
                       "version 1). Version 1's score is the pre-committed result; the live "
                       f"{CURRENT} season is the clean check for version 2."},
    }
    (SITE_DIR / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    bands = error_bands(test_v2)        # the likely range goes around version 2's predictions
    (SITE_DIR / "error_bands.json").write_text(json.dumps(bands, indent=2) + "\n")

    print(f"site data for {CURRENT}, stats through {meta['stats_through']}")
    for f in sorted(SITE_DIR.iterdir()):
        print(f"  {f.name:<20} {f.stat().st_size / 1e6:6.2f} MB")
    print(f"  {len(pl)} players, {len(tl)} teams, {len(p):,} player-game rows, {len(t):,} team-game rows")
    print("  accuracy (v1, pre-committed):", {k: v for k, v in meta.items() if k.startswith(("test", "pct", "base"))})
    print("  accuracy (v2, second look):", {k: v for k, v in meta["v2"].items() if k.startswith(("test_mae", "pct"))})
    # who gets a "Key defender" line: flagged AND still on that team (his latest team)
    shown = (onoff[onoff["key_defender"]]
             .merge(pl[["PLAYER_ID", "PLAYER_NAME", "TEAM", "TEAM_ID"]], on=["PLAYER_ID", "TEAM_ID"])
             .sort_values("def_delta_shrunk", ascending=False))
    print(f"  def_onoff ({onoff['seasons'].iloc[0]}): {len(onoff)} player-teams, "
          f"{len(shown)} 'key defender' lines ({KEY_DEF_MIN_WITH}+ games with him, "
          f"{KEY_DEF_MIN_WITHOUT}+ without, shrunk >= {KEY_DEF_MIN_SHRUNK}, still on that team):")
    cols = ["PLAYER_NAME", "TEAM", "games_with", "games_without", "def_rtg_with",
            "def_rtg_without", "def_delta", "def_delta_shrunk"]
    print("    " + shown[cols].to_string(index=False).replace("\n", "\n    "))
    print("  likely range (20th to 80th pct of misses):",
          {k: (v["p20"], v["p80"]) for k, v in bands["bands"].items()})


if __name__ == "__main__":
    main()
