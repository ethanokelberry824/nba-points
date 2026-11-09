import sys
from datetime import timedelta
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from api.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:      # "with" runs the startup (loads data + model once)
        yield c


@pytest.fixture(scope="session")
def engine(client):
    from api import main
    return main.engine


@pytest.fixture(scope="session")
def game_date(engine):
    """A valid date that doesn't depend on today: 2 days after the stats-through date."""
    return (engine.stats_through + timedelta(days=2)).strftime("%Y-%m-%d")


@pytest.fixture(scope="session")
def test_players(engine):
    """5 players across the scoring range (top scorer down to a bench guy), 3+ games."""
    pl = engine.plist[engine.plist["games"] >= 3].sort_values("ppg", ascending=False)
    picks = [pl.iloc[int(q * (len(pl) - 1))] for q in (0, 0.1, 0.3, 0.6, 0.9)]
    return [(int(p["PLAYER_ID"]), int(p["TEAM_ID"])) for p in picks]


def other_team(engine, team_id, k=0):
    return [t for t in engine.team_ids if t != team_id][k]


@pytest.fixture(scope="session")
def ts():
    return pd.Timestamp
