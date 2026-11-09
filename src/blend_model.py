"""
The final model: a weighted average of two sklearn pipelines.

    prediction = w * HistGB + (1 - w) * Huber, clipped at 0

Wrapped as a normal sklearn estimator so it works like any other model:
final_model.fit(X_train, y_train), final_model.predict(X_test).

This class lives in src/ (not in the notebook) because the saved .joblib files
point to it: anything that loads them (src/predict.py, the Streamlit app)
needs to be able to import it.
"""

import numpy as np
from sklearn.base import BaseEstimator, RegressorMixin, clone


class BlendRegressor(BaseEstimator, RegressorMixin):
    def __init__(self, hgb, huber, w=0.6):
        self.hgb = hgb        # HistGB pipeline (preprocessing + model)
        self.huber = huber    # Huber pipeline (preprocessing + model)
        self.w = w            # weight on HistGB; Huber gets 1 - w

    def fit(self, X, y):
        self.hgb_ = clone(self.hgb).fit(X, y)
        self.huber_ = clone(self.huber).fit(X, y)
        return self

    def predict(self, X):
        blend = self.w * self.hgb_.predict(X) + (1 - self.w) * self.huber_.predict(X)
        return np.clip(blend, 0, None)    # nobody scores negative points
