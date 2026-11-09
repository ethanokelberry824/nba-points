"""
Predict points with the saved deploy model. The Streamlit app calls predict_points().

    from predict import predict_points
    preds = predict_points(feature_rows)   # DataFrame with the FEATURES columns

The rows must come from the same feature code as training (src/build_features.py),
or predictions go quietly wrong.

Quick check from the command line (predicts the latest 2026-27 games in features.csv):
    python src/predict.py
"""

import sys
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

SRC = Path(__file__).resolve().parent
sys.path.insert(0, str(SRC))          # the saved model needs to import blend_model

ROOT = SRC.parent
MODEL_PATH = ROOT / "models" / "deploy_model.joblib"


@lru_cache(maxsize=1)
def load_bundle(path: Path = MODEL_PATH) -> dict:
    """Load once and keep in memory. Keys: model, features, blend_w, train_seasons, ..."""
    return joblib.load(path)


def predict_points(feature_rows: pd.DataFrame) -> np.ndarray:
    """Blended (0.6 HistGB + 0.4 Huber), clipped-at-0 points prediction for each row."""
    bundle = load_bundle()
    missing = [f for f in bundle["features"] if f not in feature_rows.columns]
    if missing:
        raise ValueError(f"feature_rows is missing columns: {missing}")
    return bundle["model"].predict(feature_rows[bundle["features"]])


if __name__ == "__main__":
    bundle = load_bundle()
    print(f"model: {bundle['description']}")
    print(f"trained on {bundle['train_seasons']} ({bundle['train_rows']:,} rows)")
    df = pd.read_csv(ROOT / "data" / "processed" / "features.csv")
    live = df[df["SEASON"] == "2026-27"].tail(8).copy()
    live["predicted"] = predict_points(live).round(1)
    print(live[["GAME_DATE", "PLAYER_NAME", "TEAM", "OPP", "predicted", "PTS"]].to_string(index=False))
