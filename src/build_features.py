"""
Step 2: build the feature table from the raw game logs.

    python src/build_features.py

Reads  data/raw/player_logs_<season>.csv and team_logs_<season>.csv
Writes data/processed/features.csv  (one row per player per game)

The big rule: every feature only uses information from BEFORE the game it
describes. Rolling stats are always groupby -> shift(1) -> rolling, so a game's
own points never leak into its own "last 5 average". Opponent stats work the
same way (only games before this date). "Previous season" values come from a
season that is already over, so they're safe too.

Leak test: python src/check_features.py

Targets (what actually happened, never use as features):
    PTS  points scored          (main target)
    MIN  minutes played         (target for stage 1 of the two-stage model)
"""

from pathlib import Path

import numpy as np
import pandas as pd

SEASONS = ["2017-18", "2018-19", "2019-20", "2020-21", "2021-22",
           "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
NEXT_SEASON = dict(zip(SEASONS[:-1], SEASONS[1:]))   # "2023-24" -> "2024-25"

# History-only seasons: loaded so they can feed last-season values and matchup
# history for the first real season, but their own rows are dropped before
# writing features.csv. Without 2017-18, every 2018-19 row would have a blank
# pts_prev_season and an unblended opponent rating.
HISTORY_SEASONS = ["2017-18"]

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_PATH = ROOT / "data" / "processed" / "features.csv"

# row filters (applied at the very end, after all features are computed)
MIN_GAME_MINUTES = 5      # drop games under 5 min (injury exits, garbage time)
MIN_AVG_MINUTES = 15      # keep players averaging 15+ min so far this season

ROLL_WINDOWS = [3, 5, 10]
ROTATION_LOOKBACK = 10    # "usual rotation" = played for the team in its last 10 games
REST_CAP = 7              # 7+ days of rest all count as "fully rested"
RETURN_CAP = 10           # 10+ games since an absence all count as "settled in"
BLEND_K = 10              # blends: last season counts like 10 games of this season
SHRINK_N = 3              # small-sample shrink: multiply by n / (n + 3)
STARTER_MIN = 28          # starter_proxy = 1 if he's averaging 28+ min over his last 5

ID_COLS = ["SEASON", "GAME_ID", "GAME_DATE", "PLAYER_ID", "PLAYER_NAME",
           "TEAM", "OPP"]
TARGET_COLS = ["PTS", "MIN"]


# ---------------------------------------------------------------- helpers

def load_logs(kind: str) -> pd.DataFrame:
    """kind = 'player' or 'team'. Stacks every season into one DataFrame."""
    frames = []
    for season in SEASONS:
        df = pd.read_csv(RAW_DIR / f"{kind}_logs_{season}.csv")
        df["SEASON"] = season
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    df["GAME_DATE"] = pd.to_datetime(df["GAME_DATE"])
    return df


def prior_stat(df: pd.DataFrame, col: str, keys: list, window: int | None = None,
               how: str = "mean") -> pd.Series:
    """Mean (or sum) of `col` over earlier rows in the same group, never the current row.

    window=None -> everything so far (season average), else the last `window` rows.
    min_periods=1, so early in the season "last 10" just means "however many so far".
    """
    def f(s):
        s = s.shift(1)
        r = s.expanding() if window is None else s.rolling(window, min_periods=1)
        return getattr(r, how)()
    return df.groupby(keys)[col].transform(f)


def prior_mean(df, col, keys, window=None):
    return prior_stat(df, col, keys, window, "mean")


def prior_sum(df, col, keys, window=None):
    return prior_stat(df, col, keys, window, "sum")


def blend(current: pd.Series, prev: pd.Series, n: pd.Series, k: int = BLEND_K) -> pd.Series:
    """Shrink this season's value toward last season's: (n*current + k*prev) / (n + k).

    n = games this season so far. With n = 0 you get last season's value; by
    n = 10 they count equally; late in the season it's mostly this season.
    No last season (rookie, or the first season we have) -> just this season.
    """
    mixed = (n * current.fillna(0) + k * prev) / (n + k)
    return mixed.where(prev.notna(), current)


def safe_div(a, b):
    with np.errstate(divide="ignore", invalid="ignore"):
        return (a / b).replace([np.inf, -np.inf], np.nan)


# ---------------------------------------------------------------- team side

def build_team_features(teams: pd.DataFrame) -> pd.DataFrame:
    """One row per team per game with schedule + team strength.

    Pace, offensive/defensive rating use the standard possessions estimate:
        poss = FGA - OREB + TOV + 0.44 * FTA
    averaged over both teams (both teams get ~the same number of possessions).

    Strength stats are season-to-date (games before this one), blended with the
    team's full previous season so the first few games aren't pure noise.
    """
    t = teams.sort_values(["TEAM_ID", "GAME_DATE"]).copy()

    # attach the opponent's box score to each team row (same GAME_ID, other team)
    opp = t[["GAME_ID", "TEAM_ID", "TEAM_ABBREVIATION", "PTS", "FGA", "OREB", "TOV", "FTA"]]
    opp = opp.rename(columns=lambda c: c if c == "GAME_ID" else f"OPP_{c}")
    t = t.merge(opp, on="GAME_ID")
    t = t[t["TEAM_ID"] != t["OPP_TEAM_ID"]].reset_index(drop=True)

    own_poss = t["FGA"] - t["OREB"] + t["TOV"] + 0.44 * t["FTA"]
    opp_poss = t["OPP_FGA"] - t["OPP_OREB"] + t["OPP_TOV"] + 0.44 * t["OPP_FTA"]
    t["POSS"] = (own_poss + opp_poss) / 2
    t["GAME_MIN"] = t["MIN"] / 5          # team MIN is summed over 5 players (240 = 48 min)

    keys = ["TEAM_ID", "SEASON"]
    g = t.groupby(keys)

    # season-to-date totals from PREVIOUS games only (cumsum minus this game)
    def before(col):
        return g[col].cumsum() - t[col]

    games_before = g.cumcount()
    out = t[["TEAM_ID", "SEASON", "GAME_ID", "GAME_DATE", "TEAM_ABBREVIATION",
             "OPP_TEAM_ID", "OPP_TEAM_ABBREVIATION"]].copy()
    out["team_game_num"] = games_before + 1
    out["team_games_before"] = games_before
    out["off_rtg"] = safe_div(100 * before("PTS"), before("POSS"))      # pts scored / 100 poss
    out["def_rtg"] = safe_div(100 * before("OPP_PTS"), before("POSS"))  # pts allowed / 100 poss
    out["pace"] = safe_div(48 * before("POSS"), before("GAME_MIN"))     # poss per 48 min
    out["pts_allowed"] = safe_div(before("OPP_PTS"), games_before)
    out["net_rtg"] = out["off_rtg"] - out["def_rtg"]

    # schedule: rest and fatigue
    days_since = g["GAME_DATE"].diff().dt.days
    out["rest_days"] = (days_since - 1).clip(upper=REST_CAP).fillna(REST_CAP)
    out["back_to_back"] = (out["rest_days"] == 0).astype(int)
    out["games_last_7"] = (
        t.set_index("GAME_DATE").groupby(keys)["GAME_ID"]
        .transform(lambda s: s.rolling("7D", closed="left").count())
        .fillna(0).to_numpy()
    )

    # each team's FULL previous season (that season is over, so no leakage)
    tot = t.groupby(keys)[["PTS", "OPP_PTS", "POSS", "GAME_MIN"]].sum()
    prev = pd.DataFrame({
        "off_rtg_prev": 100 * tot["PTS"] / tot["POSS"],
        "def_rtg_prev": 100 * tot["OPP_PTS"] / tot["POSS"],
        "pace_prev": 48 * tot["POSS"] / tot["GAME_MIN"],
        "pts_allowed_prev": tot["OPP_PTS"] / t.groupby(keys).size(),
    })
    prev["net_rtg_prev"] = prev["off_rtg_prev"] - prev["def_rtg_prev"]
    prev = prev.reset_index()
    prev["SEASON"] = prev["SEASON"].map(NEXT_SEASON)
    out = out.merge(prev, on=keys, how="left")

    for col in ["def_rtg", "pace", "pts_allowed", "net_rtg"]:
        out[f"{col}_blend"] = blend(out[col], out[f"{col}_prev"], out["team_games_before"])
    return out


def rotation_status(players: pd.DataFrame, team_feats: pd.DataFrame) -> pd.DataFrame:
    """One row per team-game per rotation player: his usual minutes and whether he played.

    "Rotation player" = played for this team in at least one of its last 10 games
                        AND averages 15+ min (skips deep-bench guys who just didn't get in).
    "Usual minutes"   = his season average minutes through his last game for this team.
    Columns: TEAM_ID, GAME_ID, PLAYER_ID, avg_min_thru, played (1 = in the box score, 0 = not).
    Used by missing_rotation_minutes below, and by the site (src/pregame.py) to list
    each team's rotation for the "who's out tonight" checklist.
    """
    p = players[["PLAYER_ID", "TEAM_ID", "SEASON", "GAME_ID", "GAME_DATE", "MIN"]].copy()
    p = p.sort_values(["PLAYER_ID", "GAME_DATE"])
    p["avg_min_thru"] = p.groupby(["PLAYER_ID", "SEASON"])["MIN"].transform(
        lambda s: s.expanding().mean())
    sched = team_feats[["TEAM_ID", "SEASON", "GAME_ID", "team_game_num"]]
    p = p.merge(sched, on=["TEAM_ID", "SEASON", "GAME_ID"])

    # each appearance at team game k makes the player "rotation" for games k+1 .. k+10
    cand = pd.concat(
        [p.assign(target_num=p["team_game_num"] + k) for k in range(1, ROTATION_LOOKBACK + 1)]
    )
    cand = (cand.sort_values("team_game_num")
                .drop_duplicates(["TEAM_ID", "SEASON", "target_num", "PLAYER_ID"], keep="last"))
    cand = cand[["TEAM_ID", "SEASON", "target_num", "PLAYER_ID", "avg_min_thru"]].merge(
        sched.rename(columns={"team_game_num": "target_num"}),
        on=["TEAM_ID", "SEASON", "target_num"])

    # mark who is in tonight's box score for this team
    played = p[["TEAM_ID", "GAME_ID", "PLAYER_ID"]].assign(played=1)
    cand = cand.merge(played, on=["TEAM_ID", "GAME_ID", "PLAYER_ID"], how="left")
    cand["played"] = cand["played"].fillna(0).astype(int)
    cand = cand[cand["avg_min_thru"] >= MIN_AVG_MINUTES]
    return cand[["TEAM_ID", "GAME_ID", "PLAYER_ID", "avg_min_thru", "played"]]


def missing_rotation_minutes(players: pd.DataFrame, team_feats: pd.DataFrame) -> pd.DataFrame:
    """For each team-game: total usual minutes of rotation players who aren't playing.

    If a rotation player (see rotation_status) isn't in tonight's box score (injury,
    rest, trade, whatever), his usual minutes count as missing. After 10 games out
    he drops off the list, since by then his teammates' own rolling averages
    already reflect it.
    """
    cand = rotation_status(players, team_feats)
    missing = cand[cand["played"] == 0]
    # fixed summing order, so the result doesn't wobble in the last decimal place
    missing = missing.sort_values(["TEAM_ID", "GAME_ID", "PLAYER_ID"])

    return (missing.groupby(["TEAM_ID", "GAME_ID"])["avg_min_thru"].sum()
                   .rename("missing_min").reset_index())


# ---------------------------------------------------------------- player side

def add_matchup_history(df: pd.DataFrame) -> pd.DataFrame:
    """pts_vs_opp_rel: how much above/below his usual scoring he plays vs this opponent.

    For every past game: rel = PTS minus his season average going into that game
    (last season's average if it was his first game; skipped if neither exists,
    and skipped for <5 min games like injury exits). Then average rel over his
    earlier games vs tonight's opponent from this season and last season only,
    and shrink toward 0: avg * n / (n + 3). Since avg = sum / n, that's sum / (n + 3).
    No meetings -> 0.
    """
    use = df["pts_season"].notna() & (df["MIN"] >= MIN_GAME_MINUTES)
    rel = (df["PTS"] - df["pts_season"]).where(use, 0)
    cnt = use.astype(int)
    tmp = df[["PLAYER_ID", "OPP_TEAM_ID", "SEASON"]].assign(rel=rel, cnt=cnt)
    keys = ["PLAYER_ID", "OPP_TEAM_ID", "SEASON"]

    # this season: earlier meetings only (cumsum minus this game); df is sorted by date
    g = tmp.groupby(keys)
    sum_this = g["rel"].cumsum() - rel
    n_this = g["cnt"].cumsum() - cnt

    # last season: all meetings (that season is over)
    last = g[["rel", "cnt"]].sum().reset_index()
    last["SEASON"] = last["SEASON"].map(NEXT_SEASON)
    last = tmp[keys].merge(last, on=keys, how="left").fillna({"rel": 0, "cnt": 0})

    n = n_this + last["cnt"].to_numpy()
    total = sum_this + last["rel"].to_numpy()
    df["pts_vs_opp_rel"] = total / (n + SHRINK_N)
    return df


def build_player_features(players: pd.DataFrame, team_feats: pd.DataFrame) -> pd.DataFrame:
    df = players.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)
    df["HOME"] = df["MATCHUP"].str.contains(" vs. ").astype(int)
    df["TSA"] = df["FGA"] + 0.44 * df["FTA"]       # true shooting attempts
    season_keys = ["PLAYER_ID", "SEASON"]
    df["games_played"] = df.groupby(season_keys).cumcount()  # games before this one

    # --- player form: scoring and minutes (season + last 3/5/10)
    df["pts_season"] = prior_mean(df, "PTS", season_keys)
    df["min_season"] = prior_mean(df, "MIN", season_keys)
    for w in ROLL_WINDOWS:
        df[f"pts_l{w}"] = prior_mean(df, "PTS", season_keys, w)
        df[f"min_l{w}"] = prior_mean(df, "MIN", season_keys, w)

    # --- shooting: volume (TSA per game) and efficiency (TS% from window TOTALS)
    df["tsa_season"] = prior_mean(df, "TSA", season_keys)
    df["tsa_l5"] = prior_mean(df, "TSA", season_keys, 5)
    df["ts_season"] = safe_div(prior_sum(df, "PTS", season_keys),
                               2 * prior_sum(df, "TSA", season_keys))
    ts_l5 = safe_div(prior_sum(df, "PTS", season_keys, 5),
                     2 * prior_sum(df, "TSA", season_keys, 5))
    n5 = df["games_played"].clip(upper=5)
    # hot/cold shooting lately, shrunk toward 0 when the last-5 window is tiny
    df["ts_hot"] = ((ts_l5 - df["ts_season"]) * n5 / (n5 + SHRINK_N)).fillna(0)

    # --- last season's values (all in the past, so no leakage)
    agg = df.groupby(season_keys).agg(pts_prev_season=("PTS", "mean"),
                                      min_prev_season=("MIN", "mean"),
                                      tsa_prev_season=("TSA", "mean"),
                                      pts_sum=("PTS", "sum"), tsa_sum=("TSA", "sum"))
    agg["ts_prev_season"] = safe_div(agg["pts_sum"], 2 * agg["tsa_sum"])
    prev = agg.drop(columns=["pts_sum", "tsa_sum"]).reset_index()
    prev["SEASON"] = prev["SEASON"].map(NEXT_SEASON)
    df = df.merge(prev, on=season_keys, how="left")

    # --- opening night: no games yet this season, so use last season's numbers
    # (rookies have no last season either, so they stay blank and get dropped)
    first = df["games_played"] == 0
    fill_from = {
        "pts_prev_season": ["pts_season", "pts_l3", "pts_l5", "pts_l10"],
        "min_prev_season": ["min_season", "min_l3", "min_l5", "min_l10"],
        "tsa_prev_season": ["tsa_season", "tsa_l5"],
        "ts_prev_season": ["ts_season"],
    }
    for src, cols in fill_from.items():
        for c in cols:
            df.loc[first, c] = df.loc[first, src]
    df["min_trend"] = df["min_l3"] - df["min_l10"]   # + = role growing, - = role shrinking

    # --- blends: this season shrunk toward last season early on
    df["pts_blend"] = blend(df["pts_season"], df["pts_prev_season"], df["games_played"])
    df["min_blend"] = blend(df["min_season"], df["min_prev_season"], df["games_played"])
    df["starter_proxy"] = (df["min_l5"] >= STARTER_MIN).astype(int)

    # --- attach team / opponent ids
    t_cols = ["TEAM_ID", "GAME_ID", "TEAM_ABBREVIATION", "OPP_TEAM_ID",
              "OPP_TEAM_ABBREVIATION", "team_game_num"]
    df = df.merge(team_feats[t_cols].rename(columns={"TEAM_ABBREVIATION": "TEAM",
                                                     "OPP_TEAM_ABBREVIATION": "OPP"}),
                  on=["TEAM_ID", "GAME_ID"], suffixes=("_raw", ""))
    df = df.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)

    # --- matchup history vs tonight's opponent (relative to his own average)
    df = add_matchup_history(df)

    # --- absences: games since returning, and how long the last absence was
    # gap = team games between his last game and this one that he sat out.
    # Uses the team he's on tonight, so a trade doesn't look like an absence.
    sched = team_feats[["TEAM_ID", "SEASON", "GAME_DATE", "team_game_num"]].sort_values("GAME_DATE")
    df["prev_date"] = df.groupby(season_keys)["GAME_DATE"].shift(1)
    lookup = df[["TEAM_ID", "SEASON", "prev_date"]].reset_index().dropna(subset=["prev_date"])
    lookup = pd.merge_asof(lookup.sort_values("prev_date"),
                           sched.rename(columns={"GAME_DATE": "prev_date",
                                                 "team_game_num": "team_games_by_prev"}),
                           on="prev_date", by=["TEAM_ID", "SEASON"])
    df["team_games_by_prev"] = lookup.set_index("index")["team_games_by_prev"]
    gap = df["team_game_num"] - 1 - df["team_games_by_prev"].fillna(0)
    absence_id = (gap > 0).groupby([df[k] for k in season_keys]).cumsum()
    df["games_since_return"] = (
        df.groupby(season_keys + [absence_id]).cumcount()
          .where(absence_id > 0, RETURN_CAP)        # never missed a game = settled in
          .clip(upper=RETURN_CAP)
    )
    # length of his most recent absence, carried forward until he's settled back in
    df["games_missed"] = (
        gap.where(gap > 0).groupby([df[k] for k in season_keys]).ffill().fillna(0)
           .where(df["games_since_return"] < RETURN_CAP, 0)
    )

    # --- teammates out tonight (and opponent players out tonight)
    miss = missing_rotation_minutes(players, team_feats)
    df = df.merge(miss.rename(columns={"missing_min": "team_missing_min"}),
                  on=["TEAM_ID", "GAME_ID"], how="left")
    df = df.merge(miss.rename(columns={"TEAM_ID": "OPP_TEAM_ID",
                                       "missing_min": "opp_missing_min"}),
                  on=["OPP_TEAM_ID", "GAME_ID"], how="left")
    df[["team_missing_min", "opp_missing_min"]] = df[["team_missing_min", "opp_missing_min"]].fillna(0)

    # --- schedule + blended team strength for his team and the opponent
    own = team_feats[["TEAM_ID", "GAME_ID", "rest_days", "back_to_back", "games_last_7",
                      "net_rtg_blend"]].rename(columns={"net_rtg_blend": "team_net_rtg"})
    df = df.merge(own, on=["TEAM_ID", "GAME_ID"])
    opp = team_feats[["TEAM_ID", "GAME_ID", "def_rtg_blend", "pace_blend",
                      "pts_allowed_blend", "net_rtg_blend"]]
    opp = opp.rename(columns={"TEAM_ID": "OPP_TEAM_ID", "def_rtg_blend": "opp_def_rtg",
                              "pace_blend": "opp_pace", "pts_allowed_blend": "opp_pts_allowed",
                              "net_rtg_blend": "opp_net_rtg"})
    df = df.merge(opp, on=["OPP_TEAM_ID", "GAME_ID"])
    df["net_rtg_gap"] = df["team_net_rtg"] - df["opp_net_rtg"]   # + = his team is better
    df["abs_net_rtg_gap"] = df["net_rtg_gap"].abs()               # lopsided either way

    return df.sort_values(["GAME_DATE", "GAME_ID", "PLAYER_ID"]).reset_index(drop=True)


FEATURES = [
    # player form
    "pts_season", "pts_l3", "pts_l5", "pts_l10", "pts_blend",
    "min_season", "min_l3", "min_l5", "min_l10", "min_trend", "min_blend",
    "tsa_season", "tsa_l5", "ts_season", "ts_hot",
    "games_played", "pts_prev_season", "min_prev_season",
    # role and context
    "HOME", "rest_days", "back_to_back", "games_last_7", "games_since_return",
    "games_missed", "starter_proxy",
    # teammates
    "team_missing_min", "opp_missing_min",
    # opponent and environment (blended with last season)
    "opp_def_rtg", "opp_pace", "opp_pts_allowed", "net_rtg_gap", "abs_net_rtg_gap",
    # matchup history (test, don't assume)
    "pts_vs_opp_rel",
]

# added in the Nov 8 feature pass (for marking them in the attribute-combinations notebook)
NEW_FEATURES = [
    "pts_blend", "min_blend", "tsa_season", "tsa_l5", "ts_season", "ts_hot",
    "games_missed", "starter_proxy", "abs_net_rtg_gap", "pts_vs_opp_rel",
]


def build(players: pd.DataFrame, teams: pd.DataFrame) -> pd.DataFrame:
    """Raw logs in, filtered feature table out (every column, not just FEATURES)."""
    team_feats = build_team_features(teams)
    df = build_player_features(players, team_feats)

    # history-only seasons were just there to feed the features above
    df = df[~df["SEASON"].isin(HISTORY_SEASONS)]

    # filters: real games only, and players with a real role
    df = df[df["MIN"] >= MIN_GAME_MINUTES]
    df = df[df["min_season"] >= MIN_AVG_MINUTES]   # NaN (rookie's opening night) drops too
    return df.reset_index(drop=True)


def main() -> None:
    players = load_logs("player")
    teams = load_logs("team")
    df = build(players, teams)

    out = df[ID_COLS + FEATURES + TARGET_COLS].copy()
    out["GAME_DATE"] = out["GAME_DATE"].dt.strftime("%Y-%m-%d")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_PATH, index=False)

    print(f"{len(players):,} player-games ({', '.join(HISTORY_SEASONS)} = history only) -> "
          f"{len(out):,} rows after filters "
          f"(MIN >= {MIN_GAME_MINUTES}, season avg >= {MIN_AVG_MINUTES} min)")
    print(out.groupby("SEASON").agg(rows=("PTS", "size"), players=("PLAYER_ID", "nunique"),
                                    avg_pts=("PTS", "mean")).round(1).to_string())
    na = out[FEATURES].isna().sum()
    print("\nblanks per feature column (count, % of rows):")
    print(pd.DataFrame({"blank": na, "pct": (100 * na / len(out)).round(2)}).to_string())
    print(f"\nsaved {len(FEATURES)} features -> {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
