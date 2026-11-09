"""
API tests.  From the project root:

    pytest api/tests -s          (-s prints the timing report)

What they prove:
  - the site's features still match training (src/check_pregame.py, needs data/raw/)
  - /predict == predict_points(pregame_features(...)) exactly, for 5 players
  - the "why this number" steps add up to the prediction
  - /rotations: usual shots (TSA) per player, and switching a player off moves
    team_missing_min / team_missing_tsa by exactly his usual minutes / shots (version 2)
  - opponent players' def_delta (context only) matches a by-hand recomputation
  - /sweep has 29 teams, agrees with /predict, and every opponent's features match a
    full pregame_features run
  - every endpoint: 200 on good input, 400 on bad input
  - /predict under 1 s and /sweep under 5 s
"""

import subprocess
import sys
import time

import numpy as np
import pytest

from conftest import ROOT, other_team

from build_features import FEATURES  # noqa: E402
from predict import predict_points  # noqa: E402
from pregame import pregame_features  # noqa: E402


# ---------------------------------------------------------------- the original match test

@pytest.mark.skipif(not (ROOT / "data" / "raw").exists()
                    or not (ROOT / "data" / "processed" / "features.csv").exists(),
                    reason="needs data/raw and features.csv (laptop only)")
def test_match_test_still_passes():
    r = subprocess.run([sys.executable, str(ROOT / "src" / "check_pregame.py")],
                       capture_output=True, text=True, cwd=ROOT)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    assert r.stdout.strip().endswith("PASS")


# ---------------------------------------------------------------- /predict == the pipeline

def _outs(client, pid, opp, date):
    """First rotation player on each side (still on the team), to test out lists too."""
    rot = client.get("/rotations", params={"player_id": pid, "opp_id": opp, "date": date}).json()
    pick = {}
    for t in rot["teams"]:
        on = [p["player_id"] for p in t["players"] if p["still_on_team"]]
        pick[t["side"]] = on[:1]
    return pick["team"], pick["opponent"]


def _cases(client, engine, test_players, game_date):
    cases = []
    for i, (pid, team_id) in enumerate(test_players):
        opp = other_team(engine, team_id, k=3 * i)
        home = i % 2 == 0
        team_out, opp_out = _outs(client, pid, opp, game_date) if i % 2 else ([], [])
        cases.append({"player_id": pid, "opp_id": opp, "date": game_date, "home": home,
                      "team_out_ids": team_out, "opp_out_ids": opp_out})
    return cases


def test_predict_matches_pipeline(client, engine, test_players, game_date):
    for body in _cases(client, engine, test_players, game_date):
        r = client.post("/predict", json=body)
        assert r.status_code == 200, r.text
        got = r.json()
        feats = pregame_features(body["player_id"], body["opp_id"], body["date"], body["home"],
                                 body["team_out_ids"], body["opp_out_ids"],
                                 players=engine.players, teams=engine.teams)
        expected = float(predict_points(feats)[0])
        assert got["prediction"] == expected, (body, got["prediction"], expected)
        for f in FEATURES:      # the reported feature values are the model's inputs
            v = got["features"][f]
            assert (v is None and np.isnan(feats[f].iloc[0])) or \
                np.isclose(v, feats[f].iloc[0], atol=1e-4), f
        lo, hi = got["likely_range"]["low"], got["likely_range"]["high"]
        assert lo <= round(expected, 1) <= hi


def test_breakdown_adds_up(client, engine, test_players, game_date):
    for body in _cases(client, engine, test_players, game_date):
        b = client.post("/predict", json=body).json()["breakdown"]
        total = b["baseline"] + sum(s["change"] for s in b["steps"])
        assert abs(total - b["prediction"]) < 0.01, (body, total, b["prediction"])
        assert [s["key"] for s in b["steps"]] == ["opponent", "schedule", "players_out",
                                                 "home", "form", "matchup"]
        assert b["approximate"] is True


# ---------------------------------------------------------------- /rotations (version 2)

def test_rotation_shots_feed_the_features(client, engine, test_players, game_date):
    """usual_tsa = his season average of FGA + 0.44 * FTA through his last game, and switching
    him off adds exactly his usual minutes and shots to team/opp_missing_min and _tsa."""
    pid, team_id = test_players[0]
    opp = other_team(engine, team_id, k=5)
    rot = client.get("/rotations", params={"player_id": pid, "opp_id": opp, "date": game_date}).json()
    base = client.post("/predict", json={"player_id": pid, "opp_id": opp, "date": game_date}).json()
    cur = engine.players[engine.players["SEASON"] == engine.season]
    for t in rot["teams"]:
        on = [p for p in t["players"] if p["still_on_team"]]
        assert on, t["abbr"]
        for p in on:
            g = cur[cur["PLAYER_ID"] == p["player_id"]]
            assert p["usual_tsa"] == pytest.approx((g["FGA"] + 0.44 * g["FTA"]).mean(), abs=0.05)
            assert p["usual_min"] == pytest.approx(g["MIN"].mean(), abs=0.05)
        side = "team" if t["side"] == "team" else "opp"
        star = max(on, key=lambda p: p["usual_tsa"])
        body = {"player_id": pid, "opp_id": opp, "date": game_date,
                "team_out_ids" if side == "team" else "opp_out_ids": [star["player_id"]]}
        out = client.post("/predict", json=body).json()["features"]
        f0 = base["features"]
        assert out[f"{side}_missing_min"] - f0[f"{side}_missing_min"] == pytest.approx(star["usual_min"], abs=0.06)
        assert out[f"{side}_missing_tsa"] - f0[f"{side}_missing_tsa"] == pytest.approx(star["usual_tsa"], abs=0.06)


def test_def_delta_by_hand(client, engine, test_players, game_date):
    """Opponent players' def_delta == his team's points allowed per 100 possessions in games
    he missed (after his first game for them) minus games he played, from plain loops."""
    teams, players = engine.teams, engine.players
    t = teams[teams["SEASON"] == engine.season]
    checked = 0
    for pid, team_id in test_players:
        opp = other_team(engine, team_id, k=2)
        rot = client.get("/rotations", params={"player_id": pid, "opp_id": opp, "date": game_date}).json()
        o = [x for x in rot["teams"] if x["side"] == "opponent"][0]
        for p in o["players"]:
            assert {"def_delta", "games_without", "games_with"} <= set(p)
        cand = [p for p in o["players"] if p["games_without"] > 0]
        if not cand:
            continue
        p = cand[0]
        games = t[t["TEAM_ID"] == opp].sort_values("GAME_DATE")
        mine = set(players[(players["PLAYER_ID"] == p["player_id"]) & (players["TEAM_ID"] == opp)]["GAME_ID"])
        tot = {"with": [0.0, 0.0], "without": [0.0, 0.0]}
        seen = False
        for g in games.itertuples():
            other = t[(t["GAME_ID"] == g.GAME_ID) & (t["TEAM_ID"] != opp)].iloc[0]
            poss = ((g.FGA - g.OREB + g.TOV + 0.44 * g.FTA)
                    + (other.FGA - other.OREB + other.TOV + 0.44 * other.FTA)) / 2
            if g.GAME_ID in mine:
                tot["with"][0] += other.PTS
                tot["with"][1] += poss
                seen = True
            elif seen:
                tot["without"][0] += other.PTS
                tot["without"][1] += poss
        delta = 100 * tot["without"][0] / tot["without"][1] - 100 * tot["with"][0] / tot["with"][1]
        assert p["def_delta"] == pytest.approx(delta, abs=0.051), p
        checked += 1
    assert checked >= 1


# ---------------------------------------------------------------- /sweep

def test_sweep_29_teams_and_matches_predict(client, engine, test_players, game_date):
    pid, team_id = test_players[0]
    r = client.get("/sweep", params={"player_id": pid, "date": game_date, "home": False})
    assert r.status_code == 200, r.text
    opps = r.json()["opponents"]
    assert len(opps) == 29
    assert team_id not in {o["opp_id"] for o in opps}
    preds = [o["prediction"] for o in opps]
    assert preds == sorted(preds, reverse=True)

    one = opps[7]
    p = client.post("/predict", json={"player_id": pid, "opp_id": one["opp_id"],
                                      "date": game_date, "home": False}).json()
    assert one["prediction"] == pytest.approx(p["prediction"], abs=1e-9)
    assert r.json()["blended_avg"] == p["key_numbers"]["blended_avg"]


@pytest.mark.parametrize("which", [1, 4])
def test_sweep_every_opponent_matches_pregame(engine, test_players, game_date, which):
    """Stronger than the spec: all 29 opponents' feature rows == a full pregame_features run."""
    pid, _ = test_players[which]
    out, X = engine._sweep(pid, game_date, True)
    for _, x in X.iterrows():
        f = pregame_features(pid, int(x["OPP_TEAM_ID"]), game_date, True,
                             players=engine.players, teams=engine.teams)
        a, b = f[FEATURES].to_numpy(float)[0], x[FEATURES].to_numpy(float)
        assert np.allclose(a, b, rtol=0, atol=1e-9, equal_nan=True), int(x["OPP_TEAM_ID"])


# ---------------------------------------------------------------- 200 / 400 on every endpoint

def test_endpoints_ok(client, engine, test_players, game_date):
    pid, team_id = test_players[0]
    opp = other_team(engine, team_id)
    ok = [
        client.get("/health"),
        client.get("/meta"),
        client.get("/players"),
        client.get("/teams"),
        client.get("/teams", params={"date": game_date}),
        client.get("/rotations", params={"player_id": pid, "opp_id": opp, "date": game_date}),
        client.post("/predict", json={"player_id": pid, "opp_id": opp, "date": game_date}),
        client.post("/predict", json={"player_id": pid, "opp_id": opp}),   # default date
        client.get("/sweep", params={"player_id": pid, "date": game_date}),
        client.get("/history", params={"player_id": pid}),
        client.get("/model-stats"),
    ]
    for r in ok:
        assert r.status_code == 200, (r.url, r.text[:300])

    teams = client.get("/teams").json()["teams"]
    assert len(teams) == 30
    assert sorted(t["def_rank"] for t in teams)[0] == 1
    players = client.get("/players").json()
    assert {"id", "name", "team", "games", "ppg", "mpg", "last5_ppg"} <= set(players[0])
    ms = client.get("/model-stats").json()
    assert {"test_results", "by_month", "by_tier", "by_role", "sample", "floor",
            "feature_importance", "live"} <= set(ms)


def test_endpoints_bad_input(client, engine, test_players, game_date):
    pid, team_id = test_players[0]
    opp = other_team(engine, team_id)
    too_early = engine.stats_through.strftime("%Y-%m-%d")
    good = {"player_id": pid, "opp_id": opp, "date": game_date}
    bad_get = [
        ("/teams", {"date": "not-a-date"}),
        ("/teams", {"date": too_early}),
        ("/rotations", {**good, "player_id": 1}),                 # unknown player
        ("/rotations", {**good, "opp_id": team_id}),              # his own team
        ("/rotations", {**good, "opp_id": 999}),                  # unknown team
        ("/rotations", {**good, "date": "2026-13-45"}),           # bad date
        ("/rotations", {"player_id": pid}),                       # missing opp_id
        ("/sweep", {"player_id": 1, "date": game_date}),
        ("/sweep", {"player_id": pid, "date": "2031-01-01"}),     # outside the season
        ("/sweep", {"player_id": "abc"}),
        ("/history", {"player_id": 1}),
        ("/history", {}),
    ]
    for path, params in bad_get:
        r = client.get(path, params=params)
        assert r.status_code == 400, (path, params, r.status_code, r.text[:200])
        assert r.json()["detail"]

    bad_post = [
        {**good, "player_id": 1},
        {**good, "opp_id": team_id},
        {**good, "date": "yesterday"},
        {**good, "date": too_early},
        {**good, "team_out_ids": [pid]},          # can't sit out the player you're predicting
        {**good, "team_out_ids": "nope"},
        {"player_id": pid},
    ]
    for body in bad_post:
        r = client.post("/predict", json=body)
        assert r.status_code == 400, (body, r.status_code, r.text[:200])


def test_stale_days(client, engine, test_players):
    pid, team_id = test_players[0]
    opp = other_team(engine, team_id)
    ts = engine.stats_through
    for days, warns in [(1, False), (2, False), (3, True)]:
        d = (ts + __import__("datetime").timedelta(days=days)).strftime("%Y-%m-%d")
        r = client.post("/predict", json={"player_id": pid, "opp_id": opp, "date": d}).json()
        assert r["stale_days"] == days
        assert (r["stale_warning"] is not None) == warns
        if warns:
            assert f"Stats are {days} days old" in r["stale_warning"]
    m = client.get("/meta").json()
    assert m["stale_days"] == (engine.default_date() - ts).days
    assert (m["stale_warning"] is not None) == (m["stale_days"] > 2)


# ---------------------------------------------------------------- speed

def test_response_times(client, engine, test_players, game_date):
    pid, team_id = test_players[0]
    opp = other_team(engine, team_id, k=5)

    def timed(fn, n=5):
        out = []
        for _ in range(n):
            t = time.perf_counter()
            r = fn()
            out.append(time.perf_counter() - t)
            assert r.status_code == 200
        return out

    # a fresh date so the first /sweep call also pays for building that day's team slate
    fresh = (engine.stats_through + __import__("datetime").timedelta(days=3)).strftime("%Y-%m-%d")
    sw_first = timed(lambda: client.get("/sweep", params={"player_id": pid, "date": fresh}), n=1)
    sw = timed(lambda: client.get("/sweep", params={"player_id": pid, "date": game_date}))
    pr = timed(lambda: client.post("/predict", json={"player_id": pid, "opp_id": opp,
                                                     "date": game_date}))
    rot = engine.rotations(pid, opp, game_date, True)["teams"]
    outs = [p["player_id"] for p in rot[0]["players"] if p["still_on_team"]][:2]
    pr_out = timed(lambda: client.post("/predict", json={"player_id": pid, "opp_id": opp,
                                                         "date": game_date, "team_out_ids": outs}))
    print("\n\nRESPONSE TIMES (seconds)")
    print(f"  /predict, nobody out      mean {np.mean(pr):.3f}  max {max(pr):.3f}")
    print(f"  /predict, 2 players out   mean {np.mean(pr_out):.3f}  max {max(pr_out):.3f}")
    print(f"  /sweep (29 teams)         mean {np.mean(sw):.3f}  max {max(sw):.3f}  "
          f"first call on a new date {sw_first[0]:.3f}")
    assert max(pr + pr_out) < 1.0
    assert max(sw + sw_first) < 5.0
