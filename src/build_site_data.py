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
    error_bands.json    2025-26 test-set misses (actual - predicted) by scoring tier, for the
                        API's "likely range" (middle 60% of misses for players like him)

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


def test_predictions() -> pd.DataFrame:
    """The 2025-26 test set with the saved final model's predictions (columns pred, resid).
    Checks they reproduce the test MAE in results/test_results.csv."""
    res = pd.read_csv(ROOT / "results" / "test_results.csv").set_index("approach")
    blend_mae = res.loc[res.index.str.startswith("Blend"), "test_MAE"].iloc[0]
    bundle = joblib.load(ROOT / "models" / "final_model.joblib")
    df = pd.read_csv(ROOT / "data" / "processed" / "features.csv",
                     usecols=["SEASON", "PTS"] + FEATURES)
    test = df[df["SEASON"] == TEST_SEASON].copy()
    test["pred"] = bundle["model"].predict(test[bundle["features"]])
    test["resid"] = test["PTS"] - test["pred"]          # + = he scored MORE than predicted
    if not np.isclose(test["resid"].abs().mean(), blend_mae):
        raise RuntimeError(f"final model MAE {test['resid'].abs().mean():.4f} "
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


def accuracy(test: pd.DataFrame) -> dict:
    """Test-set numbers for the page: MAE from results/test_results.csv, plus how often
    the final model landed within 3 / 5 points (recomputed from the saved final model)."""
    res = pd.read_csv(ROOT / "results" / "test_results.csv").set_index("approach")
    blend = res.loc[res.index.str.startswith("Blend")].iloc[0]
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

    test = test_predictions()
    meta = {
        "season": CURRENT,
        "stats_through": cur["GAME_DATE"].max().strftime("%Y-%m-%d"),
        "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        **accuracy(test),
    }
    (SITE_DIR / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    bands = error_bands(test)
    (SITE_DIR / "error_bands.json").write_text(json.dumps(bands, indent=2) + "\n")

    print(f"site data for {CURRENT}, stats through {meta['stats_through']}")
    for f in sorted(SITE_DIR.iterdir()):
        print(f"  {f.name:<20} {f.stat().st_size / 1e6:6.2f} MB")
    print(f"  {len(pl)} players, {len(tl)} teams, {len(p):,} player-game rows, {len(t):,} team-game rows")
    print("  accuracy:", {k: v for k, v in meta.items() if k.startswith(("test", "pct", "base"))})
    print("  likely range (20th to 80th pct of misses):",
          {k: (v["p20"], v["p80"]) for k, v in bands["bands"].items()})


if __name__ == "__main__":
    main()
