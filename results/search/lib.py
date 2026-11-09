import numpy as np, pandas as pd, warnings, time, json, os
warnings.filterwarnings("ignore")
from build_features import FEATURES
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler, SplineTransformer
from sklearn.pipeline import make_pipeline
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import Ridge, HuberRegressor
from sklearn.ensemble import HistGradientBoostingRegressor

SEARCH_END = pd.Timestamp("2024-12-31")   # search on games up to here
HOLD_START, HOLD_END = pd.Timestamp("2025-01-01"), pd.Timestamp("2025-04-30")
PREV = ["pts_prev_season", "min_prev_season"]
BASE = [f for f in FEATURES if f not in PREV]

def load():
    d = pd.read_csv(os.path.expanduser("~/mnt/nba-points/data/processed/features.csv"), parse_dates=["GAME_DATE"])
    d = d[~d.SEASON.isin(["2025-26", "2026-27"])]          # test + live season never loaded
    d = d.sort_values(["GAME_DATE", "GAME_ID", "PLAYER_ID"], kind="stable").reset_index(drop=True)
    # engineered extras (pre-game info only)
    d["ppm_blend"] = d.pts_blend / d.min_blend.clip(lower=1)
    d["exp_pts"] = d.pts_blend * d.opp_def_rtg * d.opp_pace / 1e4
    d["exp_pts_l5"] = d.pts_l5 * d.opp_def_rtg * d.opp_pace / 1e4
    d["miss_x_pts"] = d.team_missing_min * d.pts_blend / 100
    d["miss_x_min"] = d.team_missing_min * d.min_blend / 100
    d["no_prev"] = d.pts_prev_season.isna().astype(int)
    d["pts_l5_minus_blend"] = d.pts_l5 - d.pts_blend
    d["min_l5_minus_blend"] = d.min_l5 - d.min_blend
    d["season_idx"] = d.SEASON.str[:4].astype(int)
    return d

def date_safe_folds(dates, n_splits):
    """TimeSeriesSplit-style blocks over `dates` (sorted), boundaries snapped to date changes.
    Returns list of first-validation-date / last-validation-date pairs."""
    n = len(dates); size = n // (n_splits + 1); out = []
    for k in range(1, n_splits + 1):
        s = k * size; e = (k + 1) * size if k < n_splits else n
        vs, ve = dates.iloc[s], dates.iloc[e - 1]
        out.append((vs, ve))
    # make blocks non-overlapping on dates
    fixed = []
    for i, (vs, ve) in enumerate(out):
        if i + 1 < len(out): ve = out[i + 1][0] - pd.Timedelta(days=1)
        fixed.append((vs, ve))
    return fixed

class Split:
    def __init__(self, d):
        self.d = d
        main = d[d.SEASON.isin(["2023-24", "2024-25"])]
        srch = main[main.GAME_DATE <= SEARCH_END]
        self.folds = date_safe_folds(srch.GAME_DATE.reset_index(drop=True), 4)
        self.hold = (HOLD_START, HOLD_END)
    def windows(self, first_season):
        return self.d.season_idx >= first_season
    def tasks(self, first_season=2023, holdout=False):
        """yield (train_mask, val_mask, label)"""
        w = self.windows(first_season)
        blocks = [self.hold] if holdout else self.folds
        for i, (vs, ve) in enumerate(blocks):
            tr = w & (self.d.GAME_DATE < vs)
            va = self.d.SEASON.isin(["2023-24","2024-25"]) & (self.d.GAME_DATE >= vs) & (self.d.GAME_DATE <= ve)
            yield tr.values, va.values, ("hold" if holdout else f"f{i+1}")

def lin_pre(cols, splines=None, indicator=False):
    num = [c for c in cols if not splines or c not in splines]
    parts = [("num", make_pipeline(SimpleImputer(strategy="median", add_indicator=indicator), StandardScaler()), num)]
    if splines:
        parts.append(("spl", make_pipeline(SimpleImputer(strategy="median"), SplineTransformer(n_knots=5)), splines))
    return ColumnTransformer(parts)

def mae(a, b): return float(np.mean(np.abs(np.asarray(a) - np.asarray(b))))
