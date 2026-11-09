"""
NBA Player Points Predictor: the public site.

    streamlit run app/streamlit_app.py

Pick a player and an opponent, check off who's out, see the predicted points.
Reads only the small files in data/site/ (made by src/build_site_data.py) and
the saved model in models/deploy_model.joblib. Features come from
src/pregame.py, which runs the same feature code as training.
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from predict import predict_points  # noqa: E402
from pregame import SITE_DIR, load_site_logs, pregame_features, tonight_rotations  # noqa: E402

st.set_page_config(page_title="NBA Points Predictor", page_icon="🏀", layout="centered")

st.markdown("""
<style>
.hero { font-size: 64px; font-weight: 700; line-height: 1; margin-top: 4px; }
.hero-label { font-size: 15px; opacity: 0.75; margin-top: 6px; margin-bottom: 12px; }
.small-note { font-size: 13px; opacity: 0.7; }
</style>
""", unsafe_allow_html=True)

BAR_COLOR = "#2a78d6"     # one series, one hue
PRED_COLOR = "#eb6834"    # the prediction line


# ---------------------------------------------------------------- data (cached)

@st.cache_data
def load_data():
    players, teams = load_site_logs()
    plist = pd.read_csv(SITE_DIR / "players.csv")
    tlist = pd.read_csv(SITE_DIR / "teams.csv")
    meta = json.loads((SITE_DIR / "meta.json").read_text())
    return players, teams, plist, tlist, meta


@st.cache_data(show_spinner=False)
def rotations(player_id, opp_id, game_date):
    players, teams, *_ = load_data()
    return tonight_rotations(player_id, opp_id, game_date, players=players, teams=teams)


@st.cache_data(show_spinner=False)
def predict(player_id, opp_id, game_date, home, team_out, opp_out):
    """Predictions with the checked-off players out, and with nobody out (for the difference)."""
    players, teams, *_ = load_data()
    rows = pd.concat([
        pregame_features(player_id, opp_id, game_date, home, list(team_out), list(opp_out),
                         players=players, teams=teams),
        pregame_features(player_id, opp_id, game_date, home, [], [],
                         players=players, teams=teams),
    ], ignore_index=True)
    preds = predict_points(rows)
    return float(preds[0]), float(preds[1]), rows.iloc[0]


players, teams, plist, tlist, meta = load_data()
team_name = tlist.set_index("TEAM_ID")["TEAM_NAME"].to_dict()
team_abbr = tlist.set_index("TEAM_ID")["TEAM"].to_dict()
stats_through = pd.Timestamp(meta["stats_through"])


# ---------------------------------------------------------------- inputs

st.title("NBA Points Predictor")
st.write("Pick a player and an opponent. A machine learning model predicts how many "
         "points he scores.")
st.caption(f"Stats through {stats_through:%B %-d, %Y}.")

plist = plist.sort_values("PLAYER_NAME")
pinfo = plist.set_index("PLAYER_ID")
default_player = int(plist[plist["games"] >= 3].sort_values("ppg").iloc[-1]["PLAYER_ID"])
player_id = st.selectbox(
    "Player", plist["PLAYER_ID"].tolist(),
    index=plist["PLAYER_ID"].tolist().index(default_player),
    format_func=lambda pid: f"{pinfo.at[pid, 'PLAYER_NAME']} ({pinfo.at[pid, 'TEAM']}, "
                            f"{pinfo.at[pid, 'ppg']:.1f} ppg)",
    placeholder="Search for a player",
)
team_id = int(pinfo.at[player_id, "TEAM_ID"])
name = pinfo.at[player_id, "PLAYER_NAME"]

c1, c2, c3 = st.columns([2, 1.2, 1.4])
opp_options = [t for t in tlist["TEAM_ID"] if t != team_id]
opp_id = c1.selectbox("Opponent", opp_options, format_func=lambda t: team_name[t])
home = c2.radio("Where", ["Home", "Away"], horizontal=True) == "Home"
first_day = (stats_through + timedelta(days=1)).date()
season_end = date(int(meta["season"][:4]) + 1, 6, 30)
game_date = c3.date_input("Game date", value=max(date.today(), first_day),
                          min_value=first_day, max_value=season_end)
game_date = pd.Timestamp(game_date).strftime("%Y-%m-%d")


# ---------------------------------------------------------------- who's out

rot = rotations(player_id, opp_id, game_date)
team_games = teams[teams["GAME_DATE"] < pd.Timestamp(game_date)]
last_team_game = team_games.groupby("TEAM_ID")["GAME_DATE"].max()

st.markdown("**Who's out tonight?** Everyone plays unless you check them off. "
            "Lists each team's rotation (15+ minutes a game) with usual minutes.")
out_ids, out_names = {}, []
for col, tid in zip(st.columns(2), [team_id, opp_id]):
    r = rot[rot["TEAM_ID"] == tid]
    on, gone = r[r["on_team"] == 1], r[r["on_team"] == 0]
    box = col.expander(team_name[tid])
    picked = []
    for _, p in on.iterrows():
        label = f"{p['PLAYER_NAME']} ({p['usual_min']:.0f} min"
        if p["last_game"] < last_team_game.get(tid, p["last_game"]):
            label += f", last played {p['last_game']:%b %-d}"
        if box.checkbox(label + ")", key=f"out_{tid}_{p['PLAYER_ID']}"):
            picked.append(int(p["PLAYER_ID"]))
            out_names.append(p["PLAYER_NAME"])
    if on.empty:
        box.caption("No rotation players yet.")
    if not gone.empty:
        box.caption("Already counted as out (no longer on the team): "
                    + ", ".join(gone["PLAYER_NAME"]))
    out_ids[tid] = tuple(sorted(picked))


# ---------------------------------------------------------------- prediction

try:
    pred, base, feats = predict(player_id, opp_id, game_date, home,
                                out_ids[team_id], out_ids[opp_id])
except Exception as e:  # shouldn't happen, but don't show a stack trace to visitors
    st.error(f"Couldn't build a prediction for this matchup ({e}).")
    st.stop()

where = "vs" if home else "@"
st.subheader(f"{name} {where} {team_abbr[opp_id]}, {pd.Timestamp(game_date):%b %d}")
h, s1, s2 = st.columns([1.4, 1, 1])
h.markdown(f"<div class='hero'>{pred:.1f}</div><div class='hero-label'>predicted points</div>",
           unsafe_allow_html=True)
if out_names:
    h.caption(f"{pred - base:+.1f} with {', '.join(out_names)} out "
              f"(everyone playing: {base:.1f})")
first_game = feats["games_played"] == 0
s1.metric("Season average" + (" (last season)" if first_game else ""), f"{feats['pts_season']:.1f}")
s2.metric("Last 5 games" + (" (last season)" if first_game else ""), f"{feats['pts_l5']:.1f}")

if feats["min_blend"] < 15:
    st.caption(f"Heads up: {name} has been playing about {feats['min_blend']:.0f} minutes a game. "
               "The model was trained on players averaging 15+, so this one is a rougher guess.")

# last 10 games this season, with the prediction as a dashed line
season_games = players[(players["PLAYER_ID"] == player_id) & (players["SEASON"] == meta["season"])
                       & (players["GAME_DATE"] < pd.Timestamp(game_date))]
last10 = season_games.sort_values("GAME_DATE").tail(10).copy()
if not last10.empty:
    last10["game"] = (last10["GAME_DATE"].dt.strftime("%b %d") + " "
                      + last10["MATCHUP"].str[4:].str.replace("vs.", "vs", regex=False))
    order = last10["game"].tolist()
    bars = alt.Chart(last10).mark_bar(color=BAR_COLOR, size=22, cornerRadiusTopLeft=4,
                                      cornerRadiusTopRight=4).encode(
        x=alt.X("game:N", sort=order, title=None, axis=alt.Axis(labelAngle=-45)),
        y=alt.Y("PTS:Q", title="Points"),
        tooltip=[alt.Tooltip("game:N", title="Game"), alt.Tooltip("PTS:Q", title="Points"),
                 alt.Tooltip("MIN:Q", title="Minutes")],
    )
    pred_df = pd.DataFrame({"y": [pred], "label": [f"Prediction {pred:.1f}"]})
    rule = alt.Chart(pred_df).mark_rule(color=PRED_COLOR, strokeDash=[6, 4], strokeWidth=2).encode(
        y="y:Q", tooltip=[alt.Tooltip("label:N", title="")])
    text = alt.Chart(pred_df).mark_text(align="left", dx=4, dy=-8, color=PRED_COLOR,
                                        fontWeight="bold").encode(
        x=alt.value(0), y="y:Q", text="label:N")
    st.markdown(f"**Last {len(last10)} games this season**")
    st.altair_chart((bars + rule + text).properties(height=260), width="stretch")


# ---------------------------------------------------------------- honesty + explainer

mae = meta["test_mae"]
st.info(f"Typically off by about {round(mae)} points ({meta['pct_within_5']}% of predictions "
        f"land within 5). Assumes he plays normal minutes; doesn't know about injuries "
        f"unless you check them off.")

with st.expander("How it works"):
    st.markdown(f"""
- **Data:** every regular season NBA game since 2018-19 (8 seasons, about 150,000 player games),
  pulled from stats.nba.com.
- **Features:** 33 numbers about the game, all built only from games before it: his recent and
  season scoring and minutes (blended with last season early on), shooting volume and efficiency,
  rest and back to backs, which rotation players are out on each team, the opponent's defense
  and pace, and how he has played against this team before.
- **Model:** a blend of two models, 60% gradient boosting (lots of small decision trees) and
  40% Huber regression (a linear model that isn't thrown off by rare 50 point nights).
- **How good is it:** tested on the whole {meta['test_season']} season, which the model never saw
  while being built, it was off by **{mae:.2f} points** per game on average. Just using his
  "last 5 games average" was off by {meta['baseline_l5_mae']:.2f}. {meta['pct_within_3']}% of
  predictions landed within 3 points, {meta['pct_within_5']}% within 5, and
  {meta['pct_off_10_plus']}% were off by 10 or more.
- **What it can't know:** injury news, foul trouble, blowouts, and coaching decisions. It predicts
  a typical night, so it will miss the 40 point explosions.
""")

st.markdown(f"<p class='small-note'>Stats through {stats_through:%B %-d, %Y}. "
            f"Intro to AI final project, CSUSM, Fall 2026.</p>", unsafe_allow_html=True)
