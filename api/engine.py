"""
The API's engine: loads data/site/ and the deploy model ONCE, then answers each endpoint.

No feature math lives here. Every feature value comes from the training code
(src/build_features.py), through src/pregame.py, exactly like the Streamlit app.
What this file adds on top:
  - input checks (unknown player, own team as opponent, bad date -> BadInput -> HTTP 400)
  - the "likely range" (2025-26 test-set misses for his scoring tier, data/site/error_bands.json)
  - the "why this number" breakdown (swap groups of features to neutral values, re-predict)
  - a fast sweep over all 29 opponents (see sweep() for why it's exact)
"""

import json
import sys
import threading
from datetime import date as Date
from datetime import timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from build_features import (FEATURES, MIN_GAME_MINUTES, STARTER_MIN,  # noqa: E402
                            add_matchup_history, build_player_features, build_team_features,
                            missing_rotation_minutes)
from predict import load_bundle, predict_points  # noqa: E402
from pregame import (SITE_DIR, TONIGHT_GAME_ID, _tonight_tables, current_team,  # noqa: E402
                     latest_rosters, load_site_logs, seasons_back, tonight_rotations)

SLATE_GAME_ID0 = -100     # fake games for "every team plays tonight" (real GAME_IDs are positive)
STALE_DAYS_WARN = 2       # warn when the game is more than this many days after the stats-through date


class BadInput(ValueError):
    """Bad request from the user (becomes HTTP 400)."""


def num(v, nd: int | None = 2):
    """JSON-safe number: NaN -> None, numpy -> float, optional rounding."""
    if v is None or (isinstance(v, float) and np.isnan(v)) or pd.isna(v):
        return None
    v = float(v)
    return round(v, nd) if nd is not None else v


# The "why this number" groups, in the order they're added back.
# Each feature's neutral value is filled in by Engine._neutral().
BREAKDOWN_GROUPS = [
    ("opponent", "Opponent", ["opp_def_rtg", "opp_pace", "opp_pts_allowed",
                              "net_rtg_gap", "abs_net_rtg_gap"]),
    ("schedule", "Schedule and rest", ["rest_days", "back_to_back", "games_last_7"]),
    ("players_out", "Players out", ["team_missing_min", "opp_missing_min",
                                    "team_missing_tsa", "opp_missing_tsa"]),
    ("home", "Home / away", ["HOME"]),
    ("form", "Recent form", ["pts_l3", "pts_l5", "pts_l10", "min_l3", "min_l5", "min_l10",
                             "min_trend", "tsa_l5", "ts_hot", "starter_proxy"]),
    ("matchup", "History vs this opponent", ["pts_vs_opp_rel"]),
]
OPP_COLS = ["opp_def_rtg", "opp_pace", "opp_pts_allowed", "net_rtg_gap", "abs_net_rtg_gap",
            "opp_missing_min", "opp_missing_tsa", "pts_vs_opp_rel"]   # the only features that change with the opponent


class Engine:
    def __init__(self, site_dir: Path = SITE_DIR):
        self.players, self.teams = load_site_logs(site_dir)
        self.plist = pd.read_csv(site_dir / "players.csv")
        self.tlist = pd.read_csv(site_dir / "teams.csv")
        self.meta = json.loads((site_dir / "meta.json").read_text())
        self.bands = json.loads((site_dir / "error_bands.json").read_text())
        stats_path = site_dir / "model_stats.json"
        self.model_stats = json.loads(stats_path.read_text()) if stats_path.exists() else None
        # defense with / without each player, this season + last (context only, NOT a model feature)
        onoff_path = site_dir / "def_onoff.csv"
        self.onoff = (pd.read_csv(onoff_path).set_index(["TEAM_ID", "PLAYER_ID"])
                      if onoff_path.exists() else None)
        self.bundle = load_bundle()

        self.season = self.meta["season"]
        self.stats_through = pd.Timestamp(self.meta["stats_through"])
        self.season_end = pd.Timestamp(int(self.season[:4]) + 1, 6, 30)
        self.team_ids = sorted(int(t) for t in self.tlist["TEAM_ID"])
        self.abbr = self.tlist.set_index("TEAM_ID")["TEAM"].to_dict()
        self.name = self.tlist.set_index("TEAM_ID")["TEAM_NAME"].to_dict()
        self.pinfo = self.plist.set_index("PLAYER_ID")

        cur = self.players[self.players["SEASON"] == self.season].sort_values("GAME_DATE")
        self.last5 = cur.groupby("PLAYER_ID")["PTS"].apply(lambda s: s.tail(5).mean())
        self._lock = threading.Lock()
        self._slate = lru_cache(maxsize=32)(self._slate_uncached)

    # ------------------------------------------------------------ input checks

    def default_date(self) -> pd.Timestamp:
        return max(pd.Timestamp(Date.today()), self.stats_through + timedelta(days=1))

    def parse_date(self, s: str | None) -> pd.Timestamp:
        if s is None or s == "":
            return self.default_date()
        try:
            d = pd.Timestamp(Date.fromisoformat(s))
        except (TypeError, ValueError):
            raise BadInput(f"date must look like YYYY-MM-DD, got {s!r}")
        if d <= self.stats_through:
            raise BadInput(f"date must be after {self.stats_through:%Y-%m-%d} "
                           f"(the stats go through that day)")
        if d > self.season_end:
            raise BadInput(f"date must be in the {self.season} season "
                           f"(on or before {self.season_end:%Y-%m-%d})")
        return d

    def staleness(self, d: pd.Timestamp) -> dict:
        """stale_days = game date minus stats-through date. Display only, no effect on the math."""
        days = int((d - self.stats_through).days)
        warning = (f"Stats are {days} days old, so rest and recent form may be off. "
                   f"Refresh the data for accurate predictions." if days > STALE_DAYS_WARN else None)
        return {"stale_days": days, "stale_warning": warning}

    def check_player(self, player_id: int) -> None:
        if player_id not in self.pinfo.index:
            raise BadInput(f"unknown player_id {player_id} (not a {self.season} player; see /players)")

    def check_team(self, team_id: int, what: str = "opp_id") -> None:
        if team_id not in self.abbr:
            raise BadInput(f"unknown {what} {team_id} (see /teams)")

    def his_team(self, player_id: int, d: pd.Timestamp) -> int:
        return current_team(self.players, player_id, d)    # same default pregame_features uses

    def check_matchup(self, player_id: int, opp_id: int, d: pd.Timestamp) -> int:
        self.check_player(player_id)
        self.check_team(opp_id)
        team_id = self.his_team(player_id, d)
        if team_id == opp_id:
            raise BadInput(f"opp_id {opp_id} is the player's own team ({self.abbr[team_id]})")
        return team_id

    # ------------------------------------------------------------ feature passes

    def _tonight(self, player_id, opp_id, d, home, team_out=(), opp_out=()):
        """Same steps as pregame.pregame_features, but keeps the whole frame:
        returns (tonight's row with every column, his earlier rows, his team)."""
        p, t, team_id = _tonight_tables(player_id, opp_id, d, home, list(team_out), list(opp_out),
                                        self.players, self.teams)
        df = build_player_features(p, build_team_features(t))
        me = df[df["PLAYER_ID"] == player_id]
        row = me[me["GAME_ID"] == TONIGHT_GAME_ID].reset_index(drop=True)
        hist = me[me["GAME_ID"] != TONIGHT_GAME_ID].reset_index(drop=True)
        return row, hist, team_id

    def _slate_uncached(self, day: str) -> pd.DataFrame:
        """Every team's opponent-side numbers for a game on `day`, in one pass.

        Pretend every team plays a fake game that night (paired up arbitrarily) and
        run the training code once:
          - build_team_features -> each team's blended def rating, pace, points allowed,
            net rating going into that night (only uses that team's earlier games, so
            who it's paired with doesn't matter)
          - missing_rotation_minutes -> each team's missing minutes and shots with nobody
            checked off (rotation players traded away recently), the training rule
        Index TEAM_ID; columns def_rtg, pace, pts_allowed, net_rtg, missing_min, missing_tsa, ranks.
        """
        d = pd.Timestamp(day)
        teams = self.teams[(self.teams["GAME_DATE"] < d)
                           & self.teams["SEASON"].isin(seasons_back(self.season, 1))]
        abbr = (teams.drop_duplicates("TEAM_ID", keep="last")
                     .set_index("TEAM_ID")["TEAM_ABBREVIATION"].to_dict())
        zeros = {c: 0 for c in ["MIN", "PTS", "FGA", "OREB", "TOV", "FTA"]}
        rows = []
        for i in range(0, len(self.team_ids), 2):
            a, b = self.team_ids[i], self.team_ids[i + 1]
            gid = SLATE_GAME_ID0 - i // 2
            rows += [{"SEASON": self.season, "TEAM_ID": a, "TEAM_ABBREVIATION": abbr[a],
                      "MATCHUP": f"{abbr[a]} vs. {abbr[b]}", "GAME_ID": gid, "GAME_DATE": d, **zeros},
                     {"SEASON": self.season, "TEAM_ID": b, "TEAM_ABBREVIATION": abbr[b],
                      "MATCHUP": f"{abbr[b]} @ {abbr[a]}", "GAME_ID": gid, "GAME_DATE": d, **zeros}]
        tf = build_team_features(pd.concat([teams, pd.DataFrame(rows)], ignore_index=True))
        tonight = tf[tf["GAME_ID"] <= SLATE_GAME_ID0].set_index("TEAM_ID")

        # tonight's fake box scores: every player on his latest team (nobody checked off)
        p = self.players[(self.players["SEASON"] == self.season) & (self.players["GAME_DATE"] < d)]
        roster = latest_rosters(p, self.season, d)
        box = roster.assign(SEASON=self.season, GAME_ID=roster["TEAM_ID"].map(tonight["GAME_ID"]),
                            GAME_DATE=d, MIN=0, FGA=0, FTA=0, PTS=0)
        miss = missing_rotation_minutes(pd.concat([p, box], ignore_index=True), tf)
        miss = miss[miss["GAME_ID"] <= SLATE_GAME_ID0].set_index("TEAM_ID")

        out = pd.DataFrame({
            "def_rtg": tonight["def_rtg_blend"], "pace": tonight["pace_blend"],
            "pts_allowed": tonight["pts_allowed_blend"], "net_rtg": tonight["net_rtg_blend"],
        })
        out["missing_min"] = miss["missing_min"].reindex(out.index).fillna(0.0)
        out["missing_tsa"] = miss["missing_tsa"].reindex(out.index).fillna(0.0)
        out["def_rank"] = out["def_rtg"].rank(method="min").astype(int)            # 1 = toughest
        out["pace_rank"] = out["pace"].rank(method="min", ascending=False).astype(int)  # 1 = fastest
        return out.sort_index()

    def slate(self, d: pd.Timestamp) -> pd.DataFrame:
        with self._lock:      # lru_cache isn't a lock; avoid two threads building the same day
            return self._slate(d.strftime("%Y-%m-%d"))

    def _meetings(self, hist: pd.DataFrame) -> pd.Series:
        """Games that count toward pts_vs_opp_rel, per opponent: this season + last,
        5+ min, with a season average going in (the rule in add_matchup_history)."""
        h = hist[hist["SEASON"].isin(seasons_back(self.season, 1))
                 & hist["pts_season"].notna() & (hist["MIN"] >= MIN_GAME_MINUTES)]
        return h["OPP_TEAM_ID"].value_counts()

    # ------------------------------------------------------------ likely range

    def band(self, pred: float, pts_blend: float) -> dict:
        b = self.bands
        if pd.isna(pts_blend):
            tier, q = "all players", b["all"]
        else:
            lo_edge, hi_edge = b["tier_edges"]
            tier = b["tiers"][0 if pts_blend < lo_edge else 1 if pts_blend < hi_edge else 2]
            q = b["bands"][tier]
        return {"low": num(max(0.0, pred + q["p20"]), 1), "high": num(pred + q["p80"], 1),
                "tier": tier,
                "note": f"Middle 60% of misses on the {b['test_season']} test set for "
                        f"{tier} scorers (20th to 80th percentile of actual minus predicted)."}

    # ------------------------------------------------------------ breakdown

    def _neutral(self, x: pd.Series, hist: pd.DataFrame, slate: pd.DataFrame,
                 team_net: float) -> dict:
        """Neutral value for each breakdown feature. HOME's neutral is [0, 1]: average
        of the home and away predictions."""
        league = slate[["def_rtg", "pace", "pts_allowed", "net_rtg"]].mean()
        gap = team_net - league["net_rtg"]           # his team vs an average opponent

        # his typical schedule: most common values this season (last season if none yet)
        h = hist[hist["SEASON"] == self.season]
        if h.empty:
            h = hist[hist["SEASON"] == seasons_back(self.season, 1)[0]]
        rest = float(h["rest_days"].mode().min()) if not h.empty else 1.0
        g7 = float(h["games_last_7"].mode().min()) if not h.empty else 3.0

        return {
            "opp_def_rtg": league["def_rtg"], "opp_pace": league["pace"],
            "opp_pts_allowed": league["pts_allowed"], "net_rtg_gap": gap,
            "abs_net_rtg_gap": abs(gap),
            "rest_days": rest, "back_to_back": float(rest == 0), "games_last_7": g7,
            "team_missing_min": 0.0, "opp_missing_min": 0.0,
            "team_missing_tsa": 0.0, "opp_missing_tsa": 0.0,
            "HOME": [0, 1],
            "pts_l3": x["pts_blend"], "pts_l5": x["pts_blend"], "pts_l10": x["pts_blend"],
            "min_l3": x["min_blend"], "min_l5": x["min_blend"], "min_l10": x["min_blend"],
            "min_trend": 0.0, "tsa_l5": x["tsa_season"], "ts_hot": 0.0,
            "starter_proxy": float(x["min_blend"] >= STARTER_MIN),
            "pts_vs_opp_rel": 0.0,
        }

    def breakdown(self, x: pd.Series, hist, slate, team_net, pred: float) -> dict:
        """Start from a neutral row (his baseline), add groups back one at a time.
        State k = groups 1..k at their real values, the rest neutral. Each step is
        prediction(state k) - prediction(state k-1), so the steps add up exactly to
        the prediction. Order matters a little (the trees mix features), so it's approximate."""
        neutral = self._neutral(x, hist, slate, team_net)
        rows, owner = [], []
        for k in range(len(BREAKDOWN_GROUPS) + 1):
            r = x.copy()
            for _, _, cols in BREAKDOWN_GROUPS[k:]:
                for c in cols:
                    if c != "HOME":
                        r[c] = neutral[c]
            home_neutral = k <= [g[0] for g in BREAKDOWN_GROUPS].index("home")
            for h in (neutral["HOME"] if home_neutral else [x["HOME"]]):
                rr = r.copy()
                rr["HOME"] = h
                rows.append(rr)
                owner.append(k)
        preds = predict_points(pd.DataFrame(rows)[FEATURES])
        state = pd.Series(preds).groupby(owner).mean().to_numpy().copy()
        if not np.isclose(state[-1], pred, atol=1e-9):
            raise RuntimeError("breakdown end state doesn't reproduce the prediction")
        state[-1] = pred

        steps = []
        for k, (key, label, cols) in enumerate(BREAKDOWN_GROUPS, start=1):
            steps.append({
                "key": key, "label": label, "change": num(state[k] - state[k - 1], 3),
                "features": [{"feature": c, "value": num(x[c], 3),
                              "neutral": (neutral[c] if c == "HOME" else num(neutral[c], 3))}
                             for c in cols],
            })
        return {
            "approximate": True,
            "note": "Starts from his baseline (every factor below set to neutral: average "
                    "opponent, his usual rest, nobody out, half home / half away, recent form "
                    "equal to his usual numbers, no matchup history) and adds the factors back "
                    "one at a time in this order. The steps add up to the prediction, but the "
                    "model mixes factors, so a different order would split it a bit differently.",
            "baseline": num(state[0], 3),
            "steps": steps,
            "prediction": num(pred, 3),
        }

    # ------------------------------------------------------------ endpoints

    def predict(self, player_id: int, opp_id: int, date: str | None, home: bool,
                team_out_ids=(), opp_out_ids=()) -> dict:
        d = self.parse_date(date)
        team_id = self.check_matchup(player_id, opp_id, d)
        if player_id in set(team_out_ids) | set(opp_out_ids):
            raise BadInput("the player being predicted can't be in an out list")
        team_out, opp_out = sorted(set(team_out_ids)), sorted(set(opp_out_ids))

        row, hist, _ = self._tonight(player_id, opp_id, d, home, team_out, opp_out)
        X = row[FEATURES]
        pred = float(predict_points(X)[0])
        x = X.iloc[0]
        everyone = pred
        if team_out or opp_out:
            row0, _, _ = self._tonight(player_id, opp_id, d, home)
            everyone = float(predict_points(row0[FEATURES])[0])

        slate = self.slate(d)
        team_net = float(row["team_net_rtg"].iloc[0])
        meetings = int(self._meetings(hist).get(opp_id, 0))
        first_game = bool(x["games_played"] == 0)
        info = self.pinfo.loc[player_id]
        return {
            "player": {"id": player_id, "name": info["PLAYER_NAME"], "team_id": team_id,
                       "team": self.abbr[team_id]},
            "opponent": {"id": opp_id, "abbr": self.abbr[opp_id], "name": self.name[opp_id]},
            "date": d.strftime("%Y-%m-%d"),
            **self.staleness(d),
            "home": bool(home),
            "team_out_ids": team_out, "opp_out_ids": opp_out,
            "prediction": pred,
            "prediction_everyone_playing": everyone,
            "likely_range": self.band(pred, x["pts_blend"]),
            "key_numbers": {
                "season_avg": num(x["pts_season"], 1),
                "last_5_avg": num(x["pts_l5"], 1),
                "blended_avg": num(x["pts_blend"], 1),
                "usual_minutes": num(x["min_blend"], 1),
                "averages_from_last_season": first_game,
                "games_played": int(x["games_played"]),
                "vs_opponent": {"pts_vs_opp_rel": num(x["pts_vs_opp_rel"], 2),
                                "meetings": meetings,
                                "note": "points above (+) or below (-) his usual vs this team, "
                                        "this season and last, shrunk toward 0 when there are "
                                        "few meetings"},
                "opp_def_rtg": num(x["opp_def_rtg"], 1),
                "opp_def_rank": int(slate.at[opp_id, "def_rank"]),
                "opp_pace": num(x["opp_pace"], 1),
                "opp_pace_rank": int(slate.at[opp_id, "pace_rank"]),
                "team_missing_min": num(x["team_missing_min"], 1),
                "opp_missing_min": num(x["opp_missing_min"], 1),
                "team_missing_tsa": num(x["team_missing_tsa"], 1),
                "opp_missing_tsa": num(x["opp_missing_tsa"], 1),
                "rest_days": int(x["rest_days"]),
            },
            "low_minutes_warning": bool(x["min_blend"] < 15),
            "breakdown": self.breakdown(x, hist, slate, team_net, pred),
            "features": {f: num(x[f], 4) for f in FEATURES},
        }

    def sweep(self, player_id: int, date: str | None, home: bool) -> dict:
        return self._sweep(player_id, date, home)[0]

    def _sweep(self, player_id: int, date: str | None, home: bool) -> tuple[dict, pd.DataFrame]:
        """His prediction against every other team (nobody checked off), sorted high to low.

        Fast path, without new feature math: only 8 features depend on the opponent
        (OPP_COLS). Everything else (his form, rest, his team's missing minutes) is
        the same whoever he plays. So: one normal pregame pass vs the first opponent,
        then the opponent columns for all teams from the training functions in one go:
          - opponent strength + missing minutes / shots: the "every team plays tonight" slate
          - pts_vs_opp_rel: add_matchup_history on his past games plus one tonight
            row per opponent (each row is alone in its opponent group, so they don't
            see each other)
        api/tests/test_api.py checks every opponent against a full pregame_features run.
        """
        d = self.parse_date(date)
        self.check_player(player_id)
        team_id = self.his_team(player_id, d)
        opps = [t for t in self.team_ids if t != team_id]

        row, hist, _ = self._tonight(player_id, opps[0], d, home)
        slate = self.slate(d)

        hyp = pd.concat([row] * len(opps), ignore_index=True)
        hyp["OPP_TEAM_ID"] = opps
        mh = add_matchup_history(pd.concat([hist, hyp], ignore_index=True))
        rel = mh["pts_vs_opp_rel"].to_numpy()[len(hist):]

        X = pd.concat([row[FEATURES]] * len(opps), ignore_index=True)
        o = slate.loc[opps]
        X["opp_def_rtg"] = o["def_rtg"].to_numpy()
        X["opp_pace"] = o["pace"].to_numpy()
        X["opp_pts_allowed"] = o["pts_allowed"].to_numpy()
        X["net_rtg_gap"] = row["team_net_rtg"].iloc[0] - o["net_rtg"].to_numpy()
        X["abs_net_rtg_gap"] = X["net_rtg_gap"].abs()
        X["opp_missing_min"] = o["missing_min"].to_numpy()
        X["opp_missing_tsa"] = o["missing_tsa"].to_numpy()
        X["pts_vs_opp_rel"] = rel
        preds = predict_points(X)

        meetings = self._meetings(hist)
        pts_blend = float(row["pts_blend"].iloc[0])
        results = []
        for i, opp in enumerate(opps):
            b = self.band(float(preds[i]), pts_blend)
            results.append({
                "opp_id": opp, "abbr": self.abbr[opp], "name": self.name[opp],
                "prediction": float(preds[i]), "low": b["low"], "high": b["high"],
                "opp_def_rtg": num(o.at[opp, "def_rtg"], 1), "opp_def_rank": int(o.at[opp, "def_rank"]),
                "opp_pace": num(o.at[opp, "pace"], 1), "opp_pace_rank": int(o.at[opp, "pace_rank"]),
                "opp_missing_min": num(o.at[opp, "missing_min"], 1),
                "opp_missing_tsa": num(o.at[opp, "missing_tsa"], 1),
                "pts_vs_opp_rel": num(rel[i], 2), "meetings": int(meetings.get(opp, 0)),
            })
        results.sort(key=lambda r: r["prediction"], reverse=True)
        info = self.pinfo.loc[player_id]
        return {
            "player": {"id": player_id, "name": info["PLAYER_NAME"], "team_id": team_id,
                       "team": self.abbr[team_id]},
            "date": d.strftime("%Y-%m-%d"), "home": bool(home),
            "blended_avg": num(pts_blend, 1),    # his pts_blend going in (same for every opponent)
            "note": "Everyone playing on both teams (no one checked off).",
            "opponents": results,
        }, X.assign(OPP_TEAM_ID=opps)          # the feature rows, for the tests

    def rotations(self, player_id: int, opp_id: int, date: str | None, home: bool) -> dict:
        d = self.parse_date(date)
        team_id = self.check_matchup(player_id, opp_id, d)
        rot = tonight_rotations(player_id, opp_id, d, home, players=self.players, teams=self.teams)
        past = self.teams[self.teams["GAME_DATE"] < d]
        last_team_game = past.groupby("TEAM_ID")["GAME_DATE"].max()
        out = []
        for side, tid in [("team", team_id), ("opponent", opp_id)]:
            r = rot[rot["TEAM_ID"] == tid]
            players = []
            for _, p in r.iterrows():
                item = {
                    "player_id": int(p["PLAYER_ID"]), "name": p["PLAYER_NAME"],
                    "usual_min": num(p["usual_min"], 1),
                    "usual_tsa": num(p["usual_tsa"], 1),
                    "still_on_team": bool(p["on_team"]),
                    "last_game": p["last_game"].strftime("%Y-%m-%d"),
                    "missed_last_team_game": bool(p["last_game"] < last_team_game.get(tid, p["last_game"])),
                }
                if side == "opponent":
                    item.update(self.defense_context(tid, int(p["PLAYER_ID"])))
                players.append(item)
            out.append({"side": side, "team_id": tid, "abbr": self.abbr[tid],
                        "name": self.name[tid], "players": players})
        return {"date": d.strftime("%Y-%m-%d"), "home": bool(home),
                "note": "Rotation = 15+ min a game and played for the team in its last 10 games. "
                        "usual_min / usual_tsa = his season averages of minutes and shot attempts "
                        "(FGA + 0.44 x FTA); both feed the model when he's out. "
                        "Players with still_on_team = false were traded away and already count "
                        "as out; don't show a toggle for them. "
                        "Opponent players also get def_delta = the opponent's defensive rating "
                        "without him minus with him, this season and last combined (points "
                        "allowed per 100 possessions, + = worse without him), def_delta_shrunk = "
                        "def_delta * games_without / (games_without + 10), and key_defender = "
                        "the one player per team the site shows ('Defense without him'): the "
                        "biggest shrunk value among its rotation players with 10+ games with him, "
                        "5+ without, shrunk >= 4. CONTEXT ONLY: the model doesn't use it.",
                "teams": out}

    def defense_context(self, team_id: int, player_id: int) -> dict:
        """His team's defense with vs without him, this season + last (data/site/def_onoff.csv,
        rule and shrink in src/build_site_data.py: defense_on_off)."""
        key = (team_id, player_id)
        if self.onoff is None or key not in self.onoff.index:
            return {"def_delta": None, "def_delta_shrunk": None, "games_without": 0,
                    "games_with": 0, "key_defender": False}
        x = self.onoff.loc[key]
        return {"def_delta": num(x["def_delta"], 2), "def_delta_shrunk": num(x["def_delta_shrunk"], 2),
                "games_without": int(x["games_without"]), "games_with": int(x["games_with"]),
                "key_defender": bool(x["key_defender"])}

    def history(self, player_id: int) -> dict:
        self.check_player(player_id)
        p = self.players[self.players["PLAYER_ID"] == player_id]
        opp = self.teams[["GAME_ID", "TEAM_ID", "TEAM_ABBREVIATION"]].rename(
            columns={"TEAM_ID": "OPP_ID", "TEAM_ABBREVIATION": "OPP"})
        g = p.merge(opp, on="GAME_ID")
        g = g[g["TEAM_ID"] != g["OPP_ID"]].sort_values("GAME_DATE")
        g = g[g["SEASON"].isin(seasons_back(self.season, 1))]

        def games(df):
            return [{"date": r.GAME_DATE.strftime("%Y-%m-%d"), "season": r.SEASON,
                     "team": r.TEAM_ABBREVIATION, "opp_id": int(r.OPP_ID), "opp": r.OPP,
                     "home": " vs. " in r.MATCHUP, "pts": int(r.PTS), "min": num(r.MIN, 1),
                     "tsa": num(r.FGA + 0.44 * r.FTA, 1)} for r in df.itertuples()]

        this = g[g["SEASON"] == self.season]
        vs = []
        for opp_id, df in g.groupby("OPP_ID"):
            vs.append({"opp_id": int(opp_id), "abbr": self.abbr.get(opp_id, df["OPP"].iloc[-1]),
                       "games": len(df), "avg_pts": num(df["PTS"].mean(), 1),
                       "game_log": games(df)})
        info = self.pinfo.loc[player_id]
        return {
            "player": {"id": player_id, "name": info["PLAYER_NAME"], "team_id": int(info["TEAM_ID"]),
                       "team": info["TEAM"]},
            "season": self.season,
            "season_games": games(this),
            "vs_opponents_seasons": seasons_back(self.season, 1),
            "vs_opponents": sorted(vs, key=lambda v: v["abbr"]),
        }

    def players_list(self) -> list[dict]:
        out = []
        for r in self.plist.sort_values("PLAYER_NAME").itertuples():
            out.append({"id": int(r.PLAYER_ID), "name": r.PLAYER_NAME, "team_id": int(r.TEAM_ID),
                        "team": r.TEAM, "games": int(r.games), "ppg": num(r.ppg, 1),
                        "mpg": num(r.mpg, 1), "last5_ppg": num(self.last5.get(r.PLAYER_ID), 1),
                        "last_game": r.last_game})
        return out

    def teams_list(self, date: str | None) -> dict:
        d = self.parse_date(date)
        s = self.slate(d)
        return {"date": d.strftime("%Y-%m-%d"),
                "note": "Ratings are going into that date: season so far blended with last "
                        "season (like the model sees them). def_rank 1 = toughest defense "
                        "(fewest points allowed per 100 possessions); pace_rank 1 = fastest.",
                "teams": [{"id": t, "abbr": self.abbr[t], "name": self.name[t],
                           "def_rtg": num(s.at[t, "def_rtg"], 1), "def_rank": int(s.at[t, "def_rank"]),
                           "pace": num(s.at[t, "pace"], 1), "pace_rank": int(s.at[t, "pace_rank"])}
                          for t in sorted(self.team_ids, key=lambda t: self.name[t])]}

    def meta_info(self) -> dict:
        m = dict(self.meta)
        m["default_date"] = self.default_date().strftime("%Y-%m-%d")
        m["days_since_stats"] = (pd.Timestamp(Date.today()) - self.stats_through).days
        m.update(self.staleness(self.default_date()))     # for the default game date
        m["model"] = {"description": self.bundle.get("description"),
                      "train_seasons": self.bundle.get("train_seasons"),
                      "train_rows": self.bundle.get("train_rows")}
        m["likely_range"] = {k: {"p20": v["p20"], "p80": v["p80"]}
                             for k, v in self.bands["bands"].items()}
        return m
