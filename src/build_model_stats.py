"""
Step 5: numbers for the site's model performance page -> data/site/model_stats.json

    python src/build_model_stats.py        (refresh.sh runs it)

Everything here is a REPORT on models that are already final. Nothing feeds back
into model choices.

    test_results        every model + baseline on the 2025-26 test set (results/test_results.csv)
    by_month / by_tier / by_role
                        final model vs the last-5 baseline on the same test games
                        (same groups as the notebook's error breakdown, figures 11-13)
    sample              ~2,000 random test games: predicted vs actual (scatter plot)
    floor               baseline vs model vs "cheating" model that knows actual minutes
                        (Jan-Apr 2025, from notebooks/02_models.ipynb, "How low can MAE go?")
    feature_importance  permutation importance of the final model on the test set
                        (cached in results/test_permutation_importance.csv, ~1 min to compute)
    live                the DEPLOY model on 2026-27 games played so far, by week. Fair:
                        the deploy model was trained through 2025-26 and never saw these.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_features import FEATURES, SEASONS  # noqa: E402
from build_site_data import TIER_EDGES, TIER_LABELS  # noqa: E402
from pregame import SITE_DIR  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TEST_SEASON = "2025-26"
CURRENT = SEASONS[-1]
SAMPLE_N = 2000
SEED = 42
IMPORTANCE_CACHE = ROOT / "results" / "test_permutation_importance.csv"

# From notebooks/02_models.ipynb, "How low can MAE go?" (train before Jan 1 2025,
# score Jan-Apr 2025, 11,710 games). Needs a separate cheating model, so it isn't refit here.
FLOOR = {
    "period": "Jan-Apr 2025",
    "games": 11710,
    "baseline_l5_mae": 5.252,
    "model_mae": 4.871,
    "cheat_actual_minutes_mae": 4.177,
    "note": "The cheating model knows how many minutes he actually played. Even then it's "
            "off by 4.18, so that's roughly the floor (shooting luck). The model closes about "
            "35% of the gap between the baseline and the floor; the rest is mostly minutes "
            "surprises (injuries, blowouts, foul trouble).",
}

# plain-English names for the site
FEATURE_LABELS = {
    "pts_season": "Points per game this season",
    "pts_l3": "Points, last 3 games",
    "pts_l5": "Points, last 5 games",
    "pts_l10": "Points, last 10 games",
    "pts_blend": "Usual scoring (season blended with last season)",
    "min_season": "Minutes per game this season",
    "min_l3": "Minutes, last 3 games",
    "min_l5": "Minutes, last 5 games",
    "min_l10": "Minutes, last 10 games",
    "min_trend": "Minutes trend (last 3 minus last 10)",
    "min_blend": "Usual minutes (blended with last season)",
    "tsa_season": "Shot volume this season",
    "tsa_l5": "Shot volume, last 5 games",
    "ts_season": "Shooting efficiency this season",
    "ts_hot": "Hot / cold shooting lately",
    "games_played": "Games played this season",
    "pts_prev_season": "Points per game last season",
    "min_prev_season": "Minutes per game last season",
    "HOME": "Home game",
    "rest_days": "Days of rest",
    "back_to_back": "Back to back",
    "games_last_7": "Games in the last 7 days",
    "games_since_return": "Games since returning from an absence",
    "games_missed": "Length of his last absence",
    "starter_proxy": "Starter-level minutes (28+ over last 5)",
    "team_missing_min": "Teammates out (usual minutes)",
    "opp_missing_min": "Opponents out (usual minutes)",
    "opp_def_rtg": "Opponent defensive rating",
    "opp_pace": "Opponent pace",
    "opp_pts_allowed": "Opponent points allowed per game",
    "net_rtg_gap": "Team strength gap",
    "abs_net_rtg_gap": "Blowout risk (size of strength gap)",
    "pts_vs_opp_rel": "History vs this opponent",
}


def r(x, n=3):
    return None if pd.isna(x) else round(float(x), n)


def breakdown(rep: pd.DataFrame, col: str, order=None) -> list[dict]:
    t = rep.groupby(col, observed=True).agg(
        games=("actual", "size"), avg_points=("actual", "mean"),
        mae_model=("err_model", "mean"), mae_baseline_l5=("err_l5", "mean"))
    if order is not None:
        t = t.reindex([o for o in order if o in t.index])
    return [{"group": str(k), "games": int(v["games"]), "avg_points": r(v["avg_points"], 2),
             "mae_model": r(v["mae_model"]), "mae_baseline_l5": r(v["mae_baseline_l5"]),
             "model_better_by": r(v["mae_baseline_l5"] - v["mae_model"])}
            for k, v in t.iterrows()]


def importance(final_model, test: pd.DataFrame) -> pd.DataFrame:
    """Permutation importance of the final blend on the test set (cached: it doesn't change)."""
    if IMPORTANCE_CACHE.exists():
        return pd.read_csv(IMPORTANCE_CACHE)
    print("computing permutation importance on the test set (about a minute, cached after)...")
    perm = permutation_importance(final_model, test[FEATURES], test["PTS"],
                                  scoring="neg_mean_absolute_error", n_repeats=5,
                                  random_state=SEED)
    imp = (pd.DataFrame({"feature": FEATURES, "mae_increase": perm.importances_mean,
                         "std": perm.importances_std})
             .sort_values("mae_increase", ascending=False))
    imp.to_csv(IMPORTANCE_CACHE, index=False)
    return imp


def live_tracker(deploy, feats: pd.DataFrame) -> dict:
    """Deploy model on this season's games so far, MAE by week (weeks start Monday)."""
    live = feats[feats["SEASON"] == CURRENT].copy()
    if live.empty:
        return {"season": CURRENT, "games": 0, "weeks": []}
    live["pred"] = deploy["model"].predict(live[deploy["features"]])
    live["err_model"] = (live["PTS"] - live["pred"]).abs()
    live["err_l5"] = (live["PTS"] - live["pts_l5"]).abs()
    live["week_start"] = live["GAME_DATE"] - pd.to_timedelta(live["GAME_DATE"].dt.day_of_week, unit="D")
    weeks = []
    for i, (ws, g) in enumerate(live.groupby("week_start"), start=1):
        weeks.append({"week": i, "week_start": ws.strftime("%Y-%m-%d"),
                      "first_game": g["GAME_DATE"].min().strftime("%Y-%m-%d"),
                      "last_game": g["GAME_DATE"].max().strftime("%Y-%m-%d"),
                      "games": int(len(g)), "mae_model": r(g["err_model"].mean()),
                      "mae_baseline_l5": r(g["err_l5"].mean())})
    return {
        "season": CURRENT,
        "model": "deploy model (trained 2018-19 to 2025-26, never saw this season)",
        "stats_through": live["GAME_DATE"].max().strftime("%Y-%m-%d"),
        "games": int(len(live)),
        "mae_model": r(live["err_model"].mean()),
        "mae_baseline_l5": r(live["err_l5"].mean()),
        "pct_within_5": r(100 * (live["err_model"] <= 5).mean(), 1),
        "weeks": weeks,
    }


def main() -> None:
    feats = pd.read_csv(ROOT / "data" / "processed" / "features.csv", parse_dates=["GAME_DATE"])
    final = joblib.load(ROOT / "models" / "final_model.joblib")
    deploy = joblib.load(ROOT / "models" / "deploy_model.joblib")

    # ---- test set report (final model, trained through 2024-25)
    test = feats[feats["SEASON"] == TEST_SEASON].copy()
    test["pred"] = final["model"].predict(test[final["features"]])
    res = pd.read_csv(ROOT / "results" / "test_results.csv")
    blend_mae = res.loc[res["approach"].str.startswith("Blend"), "test_MAE"].iloc[0]
    if not np.isclose((test["PTS"] - test["pred"]).abs().mean(), blend_mae):
        raise RuntimeError("final model no longer reproduces the test MAE in results/test_results.csv")

    rep = pd.DataFrame({
        "actual": test["PTS"].to_numpy(), "pred": test["pred"].to_numpy(),
        "err_model": (test["PTS"] - test["pred"]).abs().to_numpy(),
        "err_l5": (test["PTS"] - test["pts_l5"]).abs().to_numpy(),
        "month": test["GAME_DATE"].dt.strftime("%b").to_numpy(),
        "tier": pd.cut(test["pts_blend"], TIER_EDGES, labels=TIER_LABELS, right=False).to_numpy(),
        "role": test["starter_proxy"].map({0: "bench / part-time (<28 min)",
                                           1: "starter (28+ min)"}).to_numpy(),
    })
    months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"]

    test_results = [{"approach": x["approach"], "test_mae": r(x["test_MAE"]),
                     "test_rmse": r(x["test_RMSE"]), "test_r2": r(x["test_R2"]),
                     "cv_mae": r(x["CV_MAE"]),
                     "is_baseline": x["approach"].startswith("baseline"),
                     "is_final": x["approach"].startswith("Blend")}
                    for _, x in res.iterrows()]

    smp = test.sample(min(SAMPLE_N, len(test)), random_state=SEED).sort_values("GAME_DATE")
    sample = [{"date": d.strftime("%Y-%m-%d"), "player": n, "team": t, "opp": o,
               "predicted": round(float(p), 1), "actual": int(a)}
              for d, n, t, o, p, a in zip(smp["GAME_DATE"], smp["PLAYER_NAME"], smp["TEAM"],
                                          smp["OPP"], smp["pred"], smp["PTS"])]

    imp = importance(final["model"], test)
    top = [{"feature": f, "label": FEATURE_LABELS.get(f, f), "mae_increase": r(m, 4), "std": r(s, 4)}
           for f, m, s in zip(imp["feature"], imp["mae_increase"], imp["std"])]

    err = rep["err_model"]
    stats = {
        "built_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "test_season": TEST_SEASON,
        "test_games": int(len(test)),
        "final_model": final.get("description", "0.6 HistGB + 0.4 Huber blend"),
        "test_results": test_results,
        "accuracy": {
            "mae": r(err.mean()), "mae_baseline_l5": r(rep["err_l5"].mean()),
            "pct_within_3": r(100 * (err <= 3).mean(), 1),
            "pct_within_5": r(100 * (err <= 5).mean(), 1),
            "pct_off_10_plus": r(100 * (err >= 10).mean(), 1),
            "pred_min": r(rep["pred"].min(), 1), "pred_max": r(rep["pred"].max(), 1),
            "actual_max": int(rep["actual"].max()),
        },
        "by_month": breakdown(rep, "month", months),
        "by_tier": breakdown(rep, "tier", TIER_LABELS),
        "by_role": breakdown(rep, "role"),
        "sample": sample,
        "floor": FLOOR,
        "feature_importance": {
            "method": "permutation importance of the final model on the 2025-26 test set: "
                      "shuffle one feature, see how much MAE goes up (5 repeats). Features "
                      "that overlap share credit, so near 0 means nothing new beyond the others.",
            "features": top,
        },
        "live": live_tracker(deploy, feats),
    }
    out = SITE_DIR / "model_stats.json"
    out.write_text(json.dumps(stats, indent=1, ensure_ascii=False) + "\n")

    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e3:.0f} KB)")
    print(f"  test MAE {stats['accuracy']['mae']} vs baseline {stats['accuracy']['mae_baseline_l5']}")
    print("  top features:", ", ".join(f"{t['feature']} {t['mae_increase']}" for t in top[:5]))
    lv = stats["live"]
    print(f"  live {lv['season']}: {lv['games']} games, MAE {lv.get('mae_model')} "
          f"vs baseline {lv.get('mae_baseline_l5')}, {len(lv['weeks'])} weeks")


if __name__ == "__main__":
    main()
