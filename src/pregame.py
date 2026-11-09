"""
Features for a game that hasn't happened yet (what the site predicts).

    from pregame import pregame_features
    row = pregame_features(player_id, opp_team_id, "2026-11-10", home=True,
                           team_out_ids=[...], opp_out_ids=[...])

How it works: features.csv only has rows for games already played. So we add
tonight's game to the raw logs as a fake game (all box score stats 0, which no
feature can see, since every feature uses only games BEFORE the one it
describes), then run the exact same functions as training
(build_team_features + build_player_features from build_features.py) and
read off tonight's row. No rewritten copy of the feature math, so the site
and training can't drift apart.

Who's out tonight: tonight's fake box score lists every player whose latest
team is his team or the opponent, minus the ones checked off as out. Then
the training rule decides team_missing_min / opp_missing_min: rotation players
(15+ min, played for the team in its last 10 games) who aren't in the box score.
That means a player traded away recently counts as missing automatically,
exactly like in training.

Match test (proves this gives the same numbers as features.csv):
    python src/check_pregame.py
"""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_features import (FEATURES, SEASONS, build_player_features,  # noqa: E402
                            build_team_features, rotation_status)

ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = ROOT / "data" / "site"

# raw columns the feature code reads (everything else gets trimmed for the site)
PLAYER_COLS = ["SEASON", "PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "TEAM_ABBREVIATION",
               "GAME_ID", "GAME_DATE", "MATCHUP", "MIN", "FGA", "FTA", "PTS"]
TEAM_COLS = ["SEASON", "TEAM_ID", "TEAM_ABBREVIATION", "TEAM_NAME", "GAME_ID", "GAME_DATE",
             "MATCHUP", "MIN", "PTS", "FGA", "OREB", "TOV", "FTA"]

TONIGHT_GAME_ID = -1   # the fake game; real GAME_IDs are positive


# ---------------------------------------------------------------- loading

def load_site_logs(site_dir: Path = SITE_DIR) -> tuple[pd.DataFrame, pd.DataFrame]:
    """The trimmed logs that src/build_site_data.py writes (what the app uses)."""
    players = pd.read_csv(site_dir / "player_logs.csv.gz", parse_dates=["GAME_DATE"])
    teams = pd.read_csv(site_dir / "team_logs.csv.gz", parse_dates=["GAME_DATE"])
    return players, teams


def season_of(game_date) -> str:
    """'2026-11-10' -> '2026-27'. Seasons start in Oct (Dec in 2020); the 2020 bubble ran to Aug."""
    d = pd.Timestamp(game_date)
    start = d.year if d.month >= 9 else d.year - 1
    season = f"{start}-{(start + 1) % 100:02d}"
    if season not in SEASONS:
        raise ValueError(f"{d.date()} is in season {season}, which isn't in SEASONS")
    return season


def seasons_back(season: str, n: int) -> list[str]:
    """This season plus the n before it (that we have)."""
    i = SEASONS.index(season)
    return SEASONS[max(0, i - n): i + 1]


# ---------------------------------------------------------------- tonight's game

def current_team(players: pd.DataFrame, player_id: int, game_date) -> int:
    """The team he played for in his most recent game before game_date."""
    p = players[(players["PLAYER_ID"] == player_id) & (players["GAME_DATE"] < pd.Timestamp(game_date))]
    if p.empty:
        raise ValueError(f"no games for player {player_id} before {game_date}")
    return int(p.sort_values("GAME_DATE")["TEAM_ID"].iloc[-1])


def latest_rosters(players: pd.DataFrame, season: str, game_date) -> pd.DataFrame:
    """Every player who played this season, with the team of his most recent game."""
    p = players[(players["SEASON"] == season) & (players["GAME_DATE"] < pd.Timestamp(game_date))]
    return (p.sort_values("GAME_DATE").groupby("PLAYER_ID").tail(1)
             [["PLAYER_ID", "PLAYER_NAME", "TEAM_ID"]])


def _tonight_tables(player_id, opp_team_id, game_date, home, team_out_ids, opp_out_ids,
                    players, teams, team_id=None):
    """Past logs (only what's needed) + tonight's fake game, ready for the feature code."""
    game_date = pd.Timestamp(game_date)
    season = season_of(game_date)
    if team_id is None:
        team_id = current_team(players, player_id, game_date)
    if team_id == opp_team_id:
        raise ValueError("player's team and opponent are the same")

    # only games before tonight
    players = players[players["GAME_DATE"] < game_date]
    teams = teams[teams["GAME_DATE"] < game_date]

    # team logs: this season + last (last season's full totals feed the blends)
    teams = teams[teams["SEASON"].isin(seasons_back(season, 1))]

    # player logs: him for 3 seasons (last season's matchup history needs his average
    # from 2 seasons back on last season's opening night), plus this season for everyone
    # who played for either team (their usual minutes feed team/opp_missing_min)
    this = players[players["SEASON"] == season]
    involved = this.loc[this["TEAM_ID"].isin([team_id, opp_team_id]), "PLAYER_ID"].unique()
    keep = ((players["PLAYER_ID"] == player_id) & players["SEASON"].isin(seasons_back(season, 2))) | \
           ((players["SEASON"] == season) & players["PLAYER_ID"].isin(involved))
    players = players[keep]

    # tonight's two team rows (stats 0: no feature looks at the game it describes)
    abbr = (teams.drop_duplicates("TEAM_ID", keep="last")
                 .set_index("TEAM_ID")["TEAM_ABBREVIATION"].to_dict())
    t_abbr, o_abbr = abbr[team_id], abbr[opp_team_id]
    zeros = {c: 0 for c in ["MIN", "PTS", "FGA", "OREB", "TOV", "FTA"]}
    team_rows = pd.DataFrame([
        {"SEASON": season, "TEAM_ID": team_id, "TEAM_ABBREVIATION": t_abbr,
         "MATCHUP": f"{t_abbr} vs. {o_abbr}" if home else f"{t_abbr} @ {o_abbr}", **zeros},
        {"SEASON": season, "TEAM_ID": opp_team_id, "TEAM_ABBREVIATION": o_abbr,
         "MATCHUP": f"{o_abbr} @ {t_abbr}" if home else f"{o_abbr} vs. {t_abbr}", **zeros},
    ]).assign(GAME_ID=TONIGHT_GAME_ID, GAME_DATE=game_date)

    # tonight's box score: everyone whose latest team is one of the two, minus who's out
    # (each out list only applies to its own team: a player traded from one to the
    # other can be "gone" from his old team and still play for his new one)
    roster = latest_rosters(players, season, game_date)
    roster = roster[roster["PLAYER_ID"] != player_id]       # he's added below, on team_id
    out_team = set(team_out_ids or [])
    out_opp = set(opp_out_ids or [])
    box = roster[((roster["TEAM_ID"] == team_id) & ~roster["PLAYER_ID"].isin(out_team))
                 | ((roster["TEAM_ID"] == opp_team_id) & ~roster["PLAYER_ID"].isin(out_opp))]
    me = players.loc[players["PLAYER_ID"] == player_id, ["PLAYER_ID", "PLAYER_NAME"]].tail(1)
    box = pd.concat([box, me.assign(TEAM_ID=team_id)], ignore_index=True)
    box_abbr = box["TEAM_ID"].map(abbr)
    matchup = team_rows.set_index("TEAM_ID")["MATCHUP"]
    player_rows = box.assign(SEASON=season, TEAM_ABBREVIATION=box_abbr, GAME_ID=TONIGHT_GAME_ID,
                             GAME_DATE=game_date, MATCHUP=box["TEAM_ID"].map(matchup),
                             MIN=0, FGA=0, FTA=0, PTS=0)

    players = pd.concat([players, player_rows], ignore_index=True)
    teams = pd.concat([teams, team_rows], ignore_index=True)
    return players, teams, team_id


# ---------------------------------------------------------------- public

def pregame_features(player_id: int, opp_team_id: int, game_date, home: bool,
                     team_out_ids=(), opp_out_ids=(), players: pd.DataFrame | None = None,
                     teams: pd.DataFrame | None = None, team_id: int | None = None) -> pd.DataFrame:
    """One-row DataFrame with exactly the FEATURES columns for a game on game_date.

    team_out_ids / opp_out_ids: PLAYER_IDs sitting out tonight (his team / the opponent).
    players / teams: raw game logs to use (default: the site files in data/site/).
    team_id: his team tonight (default: the team of his most recent game).
    """
    if players is None or teams is None:
        players, teams = load_site_logs()
    p, t, _ = _tonight_tables(player_id, opp_team_id, game_date, home, team_out_ids,
                              opp_out_ids, players, teams, team_id)
    df = build_player_features(p, build_team_features(t))
    row = df[(df["GAME_ID"] == TONIGHT_GAME_ID) & (df["PLAYER_ID"] == player_id)]
    return row[FEATURES].reset_index(drop=True)


def tonight_rotations(player_id: int, opp_team_id: int, game_date, home: bool = True,
                      players: pd.DataFrame | None = None, teams: pd.DataFrame | None = None,
                      team_id: int | None = None) -> pd.DataFrame:
    """Both teams' rotation players for tonight (the training definition), for the checklist.

    Columns: TEAM_ID, PLAYER_ID, PLAYER_NAME, usual_min, on_team (0 = traded away since,
    so he already counts as missing), last_game (date of his most recent game).
    """
    if players is None or teams is None:
        players, teams = load_site_logs()
    p, t, team_id = _tonight_tables(player_id, opp_team_id, game_date, home, (), (),
                                    players, teams, team_id)
    rot = rotation_status(p, build_team_features(t))
    rot = rot[rot["GAME_ID"] == TONIGHT_GAME_ID].rename(columns={"avg_min_thru": "usual_min",
                                                                 "played": "on_team"})
    past = players[players["GAME_DATE"] < pd.Timestamp(game_date)]
    info = (past.sort_values("GAME_DATE").groupby("PLAYER_ID")
                .agg(PLAYER_NAME=("PLAYER_NAME", "last"), last_game=("GAME_DATE", "last")))
    rot = rot.merge(info, left_on="PLAYER_ID", right_index=True, how="left")
    rot = rot[rot["PLAYER_ID"] != player_id]
    return (rot.sort_values(["TEAM_ID", "usual_min"], ascending=[True, False])
               [["TEAM_ID", "PLAYER_ID", "PLAYER_NAME", "usual_min", "on_team", "last_game"]]
               .reset_index(drop=True))
