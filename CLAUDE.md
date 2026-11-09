# NBA Player Points Predictor

Ethan Okelberry's Intro to AI final project at CSUSM, Fall 2026. Individual project.

- Goal: predict how many points an NBA player scores against a given opponent on a given night. Supervised regression on tabular data.
- Personal goal: a public Streamlit site where anyone picks a player and opponent and sees the prediction, linked from Ethan's personal website. Must be live by the presentation (it's the live demo).

Reference docs in `docs/`:
- `docs/proposal.md`: the proposal Ethan submitted. This is the plan of record. Stick to it unless Ethan says otherwise.
- `docs/assignment.md`: the professor's assignment prompt.
- `docs/class_example_housing.py`: the California housing example from class. Follow its workflow and sklearn style (Pipeline, ColumnTransformer, SimpleImputer, StandardScaler, GridSearchCV / RandomizedSearchCV) so the code looks like what the class taught.

## Deadlines

- Mon Nov 2: proposal submitted (done)
- ~Nov 8: data pulled (done Nov 3), features built, EDA done
- ~Nov 15: baseline, one-stage, and two-stage models trained and compared
- ~Nov 21: site live
- Nov 25: presentation slides submitted (7 min talk, week 14/15, site is the live demo)
- Dec 12: code due

## Status

- [x] Data pulled: `python src/pull_data.py` (re-run with `--refresh` to update the current season)
- [x] Data extended back to 2017-18 (Nov 8) for the 3/5/8-season window comparison
- [x] Feature table (`src/build_features.py` -> `data/processed/features.csv`, 153,400 rows, 33 features; rebuilt Nov 8)
- [x] Leak test + hand check (`python src/check_features.py`, both PASS Nov 8)
- [x] EDA notebook (`notebooks/01_eda.ipynb`; saved outputs are from the Nov 3 feature set, re-run it if you need current numbers)
- [x] Attribute combinations notebook (`notebooks/01b_attribute_combinations.ipynb`, class workflow step 4)
- [x] Models part 1: prepare data, baselines, untrained-default models, CV (`notebooks/02_models.ipynb`, Nov 8; table in `results/cv_results_part1.csv`, importance chart `figures/09_hgb_permutation_importance.png`)
- [x] Models part 2a: training window, tuning, blend, two-stage (`02_models.ipynb`, Nov 8; `results/cv_results_part2a.csv`, `results/best_params.json`; exploratory search in `results/search/`)
- [x] Models part 2b: final fit, 2025-26 test set scored ONCE, models saved (`02_models.ipynb`, Nov 8; `results/test_results.csv`, figures 10-14, `models/final_model.joblib` + `models/deploy_model.joblib`, `src/predict.py`)
- [x] Streamlit app (`app/streamlit_app.py`, Nov 8): runs locally, match test PASS (`python src/check_pregame.py`). See "Site (built Nov 8)" below.
- [x] FastAPI backend for the Next.js site (`api/`, Nov 8): 9 endpoints, 10 pytest tests PASS (`pytest api/tests -s`). See "API (built Nov 8)" below.
- [ ] GitHub repo (project isn't a git repo yet), then deploy the API (Render or HF Spaces, `api/Dockerfile`)
- [x] Next.js front end, all 4 pages (`web/`, Nov 8): Matchup, vs Every Team, Model Performance, How It Works. Lint + build PASS, Playwright + axe check PASS on every page at desktop/phone in dark/light (`npm run screenshots`). See "Front end (built Nov 8)" below.
- [ ] Add the GitHub URL to `GITHUB_URL` in `web/src/app/how-it-works/page.tsx` once the repo exists
- [ ] Deploy the front end on Vercel (root directory `web/`, set `NEXT_PUBLIC_API_URL` to the hosted API; add the Vercel URL to the API's `CORS_ORIGINS`)
- [ ] Streamlit Cloud deploy of the backup app (optional once the Next.js site is live)
- [ ] Slides
- [ ] Before Dec 12: update 01_eda.ipynb to the new feature names so the whole project re-runs end to end

Update this checklist as things get done.

## Assignment requirements

- Supervised learning on tabular data. Compare at least 2 algorithms.
- Follow the class workflow: frame the problem, get data, split off the test set, EDA, cleaning and feature engineering, sklearn pipelines / ColumnTransformer, train, cross-validate, tune, evaluate on the test set once at the end.

## AI use

- The professor encourages AI use in this class. The GenAI restriction in `docs/assignment.md` is outdated; use AI fully for code, debugging, drafting, and analysis.
- Explain what we build so Ethan understands it and can answer questions in the presentation.
- AI use gets disclosed in submissions with transcripts.

## Data

- Source: nba_api (wrapper for stats.nba.com, no API key). Pull only on Ethan's laptop; stats.nba.com blocks cloud IPs and throttles fast requests.
- Needs Python 3.10+. macOS system Python 3.9 (LibreSSL) hangs with read timeouts on stats.nba.com.
- Raw files in `data/raw/` (never edit these):
  - `player_logs_<season>.csv`: one row per player per game, from `LeagueGameLog(player_or_team_abbreviation='P')`. Columns include PLAYER_ID, PLAYER_NAME, TEAM_ID, TEAM_ABBREVIATION, GAME_ID, GAME_DATE, MATCHUP, WL, MIN, FGM, FGA, FG3M, FG3A, FTM, FTA, OREB, DREB, REB, AST, STL, BLK, TOV, PF, PTS, PLUS_MINUS.
  - `team_logs_<season>.csv`: one row per team per game (same endpoint with 'T'). Use these to compute opponent defense, pace, and points allowed from prior games only.
  - MATCHUP looks like `LAL vs. BOS` (home) or `LAL @ BOS` (away). Parse home/away and opponent from it.
  - Seasons: 2017-18 through 2025-26 (full seasons, ~26k player rows each) and 2026-27 (current season, for the live site).
  - 2017-18 is history only: it feeds last-season values and matchup history for 2018-19, but its own rows are not in features.csv.
  - Unusual seasons, kept on purpose: 2019-20 (COVID stop, finished in the Orlando bubble, 1,059 games, no home crowds at the end) and 2020-21 (72-game season, 1,080 games, mostly empty arenas, so home court was weaker). The window comparison will show whether they hurt.
- Not in the game logs: starter vs bench. That needs box scores (BoxScoreTraditionalV3, one call per game). Pull those only if the feature is worth it.
- Filtering: players averaging ~15+ min (not final), drop games under ~5 min.

## Model design

Target: player points in a game. Metrics: MAE (main), RMSE, R².

Compare three approaches, each with Ridge and HistGradientBoostingRegressor (Random Forest as backup):
1. Baseline: player's last-5-game points average. Everything has to beat this.
2. One-stage: predict points directly.
3. Two-stage (main approach, like real projection systems):
   - Model 1 predicts minutes.
   - Model 2 predicts points using predicted minutes as a feature.
   - Train model 2 on out-of-fold predicted minutes (cross_val_predict), never actual box score minutes.
   - Optional: rescale each team's predicted minutes to 240 (+OT); compare against points-per-minute x minutes if time allows.

Hyperparameters: Ridge alpha; HGB learning_rate, max_iter, max_depth, min_samples_leaf; RF n_estimators, max_depth, max_features.

Validation (from the proposal; training window updated Nov 8, see part 2a results): hold out 2025-26 as the test set. Train on 2018-19 to 2024-25 (was 2023-24 and 2024-25 before the window comparison). Tune with TimeSeriesSplit inside GridSearchCV / RandomizedSearchCV. Test set gets used once at the end. Optional experiment: retrain on 3, 5, and 8 seasons and compare MAE on the same test set. features.csv has a SEASON column so the models notebook can pick the window. Per the proposal, window sizes count seasons of data TOTAL, including the 2025-26 test season: 3 = train 2023-24 to 2024-25 (the default), 5 = train 2021-22 to 2024-25, 8 = train 2018-19 to 2024-25. All three fit the data we have, so no extra pull is needed (resolved Nov 8; replaces the earlier OPEN note).

## Features (33, in `FEATURES` in `src/build_features.py`; let CV and feature importance decide)

All of them use only games before the one being predicted. k = 10 for blends, small-sample shrink = n / (n + 3).

Player form:
- `pts_season`, `pts_l3`, `pts_l5`, `pts_l10`: points per game, season so far and last 3/5/10
- `pts_blend`: season PPG shrunk toward last season's PPG: (games * season + 10 * last) / (games + 10)
- `min_season`, `min_l3`, `min_l5`, `min_l10`: same for minutes
- `min_trend`: min_l3 minus min_l10 (+ = role growing)
- `min_blend`: same blend as pts_blend, for minutes
- `tsa_season`, `tsa_l5`: true shooting attempts per game, FGA + 0.44 * FTA (replaced the separate FGA/3PA/FTA averages)
- `ts_season`: season points / (2 * season TSA), from totals, not an average of per-game TS%
- `ts_hot`: last-5 TS% minus season TS%, times n / (n + 3) (n = games in the last-5 window)
- `games_played`: games before this one this season
- `pts_prev_season`, `min_prev_season`: last season's averages (blank for rookies, filled by the imputer)

Role and context:
- `HOME`, `rest_days` (capped at 7), `back_to_back`, `games_last_7`
- `games_since_return`: games since coming back from an absence (capped at 10 = settled in)
- `games_missed`: length of his most recent absence, carried until he's 10 games back, then 0
- `starter_proxy`: 1 if min_l5 >= 28 (stand-in for real starter data)

Teammates:
- `team_missing_min`, `opp_missing_min`: usual minutes of rotation players sitting out tonight, his team and the opponent

Opponent and environment (all blended with the team's full previous season, k = 10; first game = last season's value):
- `opp_def_rtg`, `opp_pace`, `opp_pts_allowed`
- `net_rtg_gap`: his team's blended net rating minus the opponent's (+ = his team is better)
- `abs_net_rtg_gap`: size of the gap either way (blowout risk, which Ridge can't see from the signed gap)

Matchup history:
- `pts_vs_opp_rel`: average of (PTS minus his season average going into that game) over earlier games vs this opponent, this season + last season only, times n / (n + 3). 0 if none. Skips <5 min games.

Other decisions:
- Opening night: a player's first game of the season uses last season's values for pts/min/tsa/ts features (ts_hot = 0), so it isn't dropped anymore. Rookies still drop on opening night. The 15-min filter uses the filled min_season.
- Missing values left: pts_prev_season / min_prev_season (~9%, rookies) and ts_season (3 rows). SimpleImputer(median) fit on training data only.

## Hard rules

- No leakage: every rolling or derived feature uses only games before the one being predicted (groupby player, shift(1), then rolling). Opponent stats too: only games before this date. No season-level aggregates from stats.nba.com that include future games.
- Train/test split by date, never random.
- Fit preprocessing on training data only (keep it inside the Pipeline).

## Feature table notes (rebuilt Nov 8)

- `data/processed/features.csv`: 153,400 rows, 33 features, seasons 2018-19 to 2026-27. Rows per season: 2018-19 19,985 | 2019-20 17,363 | 2020-21 17,436 | 2021-22 19,308 | 2022-23 19,276 | 2023-24 19,103 | 2024-25 19,365 | 2025-26 19,832 | 2026-27 1,732 (through Nov 2). ~300 per season are opening-night rows that used to be dropped.
- Default split: train = 2023-24 + 2024-25 (38,468 rows), test = 2025-26. The 2026-27 rows are NOT part of train or test; filter them out before splitting. They're only for the live site (and maybe a "how does it do this season" bonus check at the end).
- Leak test (`src/check_features.py`): rebuilt with every game after 2025-01-15 deleted from the raw logs; all 33 features for games before that date are identical to the full build. Hand-checked tsa_l5, ts_hot and pts_vs_opp_rel for Jayson Tatum on 2025-02-12 against the raw logs.
- Opponent blend fixed the early-season noise: in a team's games 2 to 10, opp_def_rtg used to range 82 to 144, now 102 to 118.
- Attribute combinations (`01b`): pts_blend is the single best feature (0.678 corr with PTS). Against points above his own average, team_missing_min leads (0.145), then min_trend and opponent defense. In a player's first 5 games pts_blend beats pts_season (0.690 vs 0.637). abs_net_rtg_gap is ~0 for points and minutes; kept, CV decides.
- Deferred: real starter vs bench (needs a box score call per game). starter_proxy stands in for now. Only pull box scores if the models show a gap that role explains.

## Model results so far (part 1, Nov 8)

Setup: train 2023-24 + 2024-25 sorted by date, TimeSeriesSplit(n_splits=5) for every model and baseline (same validation folds). No tuning, test set untouched.

- Data cleaning: options 2/3/4 tied with Ridge (4.948 / 4.949 / 4.949 CV MAE). Rule = lowest CV MAE, so option 2 won: the models DROP pts_prev_season and min_prev_season (31 features into the pipeline; the columns stay in features.csv). Last season's info is already inside pts_blend / min_blend / opening-night fills. Option 1 (drop rookie rows) scored a different row set, so it wasn't a fair comparison, and it would leave rookies unpredictable on the site.
- preprocessing = ColumnTransformer([("num", make_pipeline(SimpleImputer(median), StandardScaler()), num_attribs)]). Median imputer only covers 1 stray ts_season blank now. No categorical attributes.
- CV MAE (mean +/- std over 5 folds): Ridge 4.948 (0.057), LinearRegression 4.948, HistGB default 4.993 (0.050), pts_blend baseline 5.078, pts_season 5.091, pts_l5 baseline 5.274. R2: Ridge 0.483, pts_l5 0.404.
- Ridge beats the pts_l5 baseline by 0.33 points (~6%) and the best baseline (pts_blend) by 0.13.
- Train vs CV MAE: Ridge 4.90 vs 4.95 (no overfitting); HistGB 4.68 vs 4.99 (mild overfitting with defaults). Ridge vs HistGB gap (0.045) is within fold noise; tuning decides.
- Permutation importance (HistGB, last fold): pts_blend 1.28 MAE points, tsa_l5 0.20, team_missing_min 0.13, then pts_l10 / pts_l3 / min_l3. Opponent, schedule, matchup features ~0. Correlated features share credit, so near-zero = nothing new beyond the others.

## Model results part 2a (Nov 8): CURRENT BEST MODEL

Best model: **blend = 0.6 * tuned HistGB + 0.4 * tuned Huber, CV MAE 4.899** (pts_l5 baseline 5.275, ~7% better). Params in `results/best_params.json`.

| approach | CV MAE (std) | RMSE | R2 | kept? |
|---|---|---|---|---|
| Blend 0.6 HistGB + 0.4 Huber | 4.899 (0.024) | 6.329 | 0.485 | yes, CHOSEN (beats Huber 5/5, HistGB 5/5) |
| HistGB tuned | 4.903 (0.025) | 6.337 | 0.484 | beats Huber 4/5 |
| Two-stage Huber | 4.908 (0.024) | 6.340 | 0.484 | no (3/5 vs one-stage) |
| Huber tuned | 4.909 (0.024) | 6.338 | 0.484 | beats Ridge 5/5 |
| Ridge tuned / LinearRegression | 4.937 (0.024) | 6.330 | 0.485 | |
| baseline pts_blend | 5.080 (0.063) | 6.551 | 0.448 | |
| baseline pts_season | 5.092 (0.055) | 6.569 | 0.445 | |
| baseline pts_l5 | 5.275 (0.025) | 6.814 | 0.403 | |

Setup (replaces part 1's setup for everything going forward):
- Training data: 2018-19 to 2024-25 (131,836 rows), sorted by GAME_DATE.
- CV: 5 date-safe blocks over 2023-24 + 2024-25 (TimeSeriesSplit pattern: first 1/6 is train-only), boundaries on date changes, each fold trains on ALL earlier rows back to 2018-19. Built as a list of (train_idx, val_idx), passed as cv= everywhere.
- Preprocessing: all 33 FEATURES, SimpleImputer(median, add_indicator=True) + StandardScaler in one ColumnTransformer. (Tied with dropping pts_prev_season / min_prev_season: 4.9126 vs 4.9124.)
- Decision rule: keep a change only if it wins in 4+ of 5 folds.

Results (CV MAE, mean over 5 folds):
- Training window (default Huber): 3 seasons 4.9255, 5 seasons 4.9124, 8 seasons 4.9126. 5 vs 8 tie (3-2 folds), so the 8-season plan stands under the 4-of-5 rule. COVID seasons didn't hurt.
- Ridge GridSearch: alpha 0.1 to 100 all ~4.937 (= LinearRegression). Train MAE 4.85.
- Huber GridSearch: epsilon 1.1, alpha 0.001 -> 4.9087. Train MAE 4.83. Beats Ridge in 5/5 folds.
- HistGB RandomizedSearch (30 iter): absolute_error, lr 0.055, max_iter 600, max_leaf_nodes 7, min_samples_leaf 500, l2 0.10, max_features 0.7 -> 4.9034. Train MAE 4.77 (gap 0.14 vs 0.32 untuned). Top 5 configs within 0.002 (flat plateau).
- Blend w: 0.3 to 0.8 all beat both single models; 0.6 best (4.8990). Blend beats Huber 5/5 and HistGB 5/5.
- Two-stage Huber (stage 1 minutes, inner date-safe OOF, first inner block left out): 4.9080 vs one-stage 4.9087, 3/5 folds = tie, NOT kept. Stage 1 minutes MAE 4.50 vs min_l5 baseline 4.76. Why: linear stage 1 is a mix of features stage 2 already has; it would need outside minutes info (injury/lineup news).
- RMSE: Ridge 6.330 ~ blend 6.329 even though its MAE is worse (Ridge aims at the mean, MAE rewards the median).
- Floor check, Jan to Apr 2025 (train before Jan 1): pts_l5 5.252, tuned Huber 4.871, Huber + ACTUAL minutes (cheat) 4.177. Model closes ~35% of the baseline-to-floor gap; the rest is mostly minutes surprises.
- What didn't help (`results/search/`): expected-points / usage-interaction / streak-difference features, splines, recency weighting, predicting points-above-average, squared/Poisson loss for HistGB, Ridge alpha, two-stage.

## Test set results part 2b (Nov 8): FINAL, do not change the model based on these

The 2025-26 test set has now been scored. It's a report, not a decision: no model choices change because of it.

| approach | test MAE | test RMSE | test R2 | CV MAE |
|---|---|---|---|---|
| **Final blend 0.6 HistGB + 0.4 Huber (clipped at 0)** | **4.857** | 6.278 | 0.466 | 4.899 |
| HistGB tuned | 4.862 | 6.285 | 0.465 | 4.903 |
| Huber tuned | 4.866 | 6.287 | 0.465 | 4.909 |
| Ridge tuned | 4.902 | 6.283 | 0.465 | 4.937 |
| baseline pts_blend | 5.051 | 6.538 | 0.421 | 5.080 |
| baseline pts_season | 5.061 | 6.560 | 0.417 | 5.092 |
| baseline pts_l5 | 5.237 | 6.762 | 0.381 | 5.275 |

- Held up: same ranking as CV. Every approach (baselines too) was ~0.03-0.04 better on 2025-26 than in CV, so it was an easier season, not luck. Gap over pts_l5: 0.380 on test vs 0.376 in CV (7.3%).
- Breakdowns (final blend vs pts_l5): beats it in every group. Games 0-10 4.91 (gain 0.41), 31+ 4.84. Hardest months Oct 5.05 / Apr 5.09, easiest Jan 4.63. Starters 5.54 vs bench 4.37. Tiers: <10 ppg 4.09, 10-20 5.19, 20+ 6.25 (gain 0.52 for stars). Figures 10-14 in `figures/`.
- Predictions range 1.7 to 35.1 (actual 0 to 83): it predicts the typical night. 39% within 3 points, 60% within 5, 10% off by 10+.
- Live check, deploy model on 2026-27 through Nov 2 (1,732 games): 4.908 vs pts_l5 5.485.

Saved models (each a dict: model, features, blend_w, train_seasons, train_rows, params, cv_mae, test_mae_2025_26, sklearn_version):
- `models/final_model.joblib`: trained 2018-19 to 2024-25; reproduces the 4.857 test MAE.
- `models/deploy_model.joblib`: same recipe refit on 2018-19 to 2025-26 (151,668 rows). Used by the site; its expected accuracy = the test score.
- `src/blend_model.py`: `BlendRegressor` (the saved models need to import it). `src/predict.py`: `predict_points(feature_rows)` loads the deploy model; `python src/predict.py` is a quick check.
- For Streamlit Cloud: pin `scikit-learn==1.9.1` in requirements.txt (pickled models need the same sklearn version). After a data refresh, the deploy model doesn't need retraining mid-season; only the feature rows change.

## Background: how pro projection systems work (use in slides)

From the planning research. This is why the two-stage design exists:
- Minutes first: FiveThirtyEight blended a rolling 5-game minutes average into its forecasts. Razzball's Stocktonator projects minutes from recent games plus starter/bench role, then redistributes so each team sums to 240 (+OT). RotoValue does the same team-total adjustment.
- Even DARKO (Kostya Medvedovsky's system, the analytics community's gold standard) outsources preseason minutes projections, because minutes are the hardest part to predict.
- Scoring rate: per-36 or per-minute rates, weighted toward recent games, times projected minutes. Exclude games under ~5 min (injury, ejection) so rates aren't skewed.
- Usage shifts when teammates sit: a player's scoring rate goes up when a high-usage teammate is out. That's what the "missing rotation minutes" feature and the site's "who's out" toggle are for.
- Environment: projected pace (more possessions = more chances to score) and opponent defense.
- Blowouts suppress starters' minutes. That's noise we live with; the net rating gap is a partial proxy.
- Presentation angle: "I built it the way the pros do, and here's whether it actually beat the simpler approach."

## Architecture (Nov 8)

```
Next.js front end (Vercel)  --HTTP/JSON-->  FastAPI (api/main.py, Render or HF Spaces)
                                               |
                                               v
                                api/engine.py (loads data/site/ + deploy model once)
                                               |
                         src/pregame.py (features, SAME code as training: build_features.py)
                                               |
                         src/predict.py (models/deploy_model.joblib, 0.6 HistGB + 0.4 Huber)
```
- The Streamlit app (`app/streamlit_app.py`) stays as the backup; it uses the same pregame/predict code.
- Data flow: laptop runs `./refresh.sh` -> push `data/site/` -> the API redeploys with new stats.

## Site plan (Streamlit, original plan; Next.js + FastAPI is now the main site)

- App: player dropdown, opponent dropdown, "who's out tonight" checklist, prediction display.
- One shared feature-building function used by both training and the site. If the two versions drift apart, site predictions go quietly wrong. Put it in `src/` and import it in both places.
- Data refresh: the hosted app can't reach stats.nba.com (cloud IPs get blocked). Refresh on the laptop with `./refresh.sh`, push `data/site/` to GitHub, and the app redeploys.
- Hosting: Streamlit Community Cloud (free, deploys from GitHub, URL like `nba-points.streamlit.app`). About 1 GB memory, apps sleep after ~12 hours without traffic, no custom domain.
- Link to it from the personal site with a button, NOT an iframe embed. Embedded apps can't be woken from inside the iframe.
- Wake the app up before the presentation.
- Build order: model first (~Nov 15), then the site (~Nov 21). Grade comes from the ML part.

## Site (built Nov 8)

Run it: `source .venv/bin/activate && streamlit run app/streamlit_app.py` (opens localhost:8501).
Refresh the data: `./refresh.sh` (pull_data --refresh -> build_features -> build_site_data -> build_model_stats -> check_pregame), then commit + push `data/site/`.

- `src/pregame.py`: `pregame_features(player_id, opp_team_id, game_date, home, team_out_ids, opp_out_ids)` -> one row of FEATURES for a game that hasn't happened. It appends tonight as a fake game (box score stats 0) to the logs and runs the SAME `build_team_features` / `build_player_features` as training, then reads tonight's row. No copied feature math.
  - Tonight's fake box score = everyone whose latest team is his team or the opponent, minus the checked-off players. The training rule then computes team/opp_missing_min. So a player traded away within the last 10 team games counts as missing automatically (same as training). Each out list applies only to its own team (a GSW->ATL trade bug caught by the match test).
  - `tonight_rotations(...)` lists each team's rotation (training definition) for the checklist. Uses `rotation_status()`, split out of `missing_rotation_minutes()` in build_features.py (refactor verified: full rebuild identical to features.csv, all 153,400 rows x 33 features).
  - Optional args: `players`/`teams` (default: data/site files), `team_id` (default: team of his latest game).
- `src/check_pregame.py` (match test): 25 random real games (15 from 2025-26, 10 from 2026-27), rebuilt with the actual date/home/opponent and the players who actually sat out. All 33 features match features.csv (max diff 3e-14); 2026-27 games also checked against the site files. Also passed a one-off 400-game run.
- `src/build_site_data.py` -> `data/site/` (~0.6 MB): player_logs.csv.gz (this season everyone + 2 seasons back for current players), team_logs.csv.gz (this + last season), players.csv, teams.csv, meta.json (stats-through date + test accuracy: MAE 4.86, pts_l5 5.24, 39% within 3, 60% within 5, 10% off by 10+, recomputed from final_model and checked against test_results.csv).
- App: player search (default = top scorer), opponent, home/away, date (default today, min = day after stats-through). Who's out = two collapsible checklists (rotation players, usual minutes, "last played" hint if he missed the team's last game). Shows the prediction, season avg, last-5 avg, change vs nobody out, last-10 chart with a dashed prediction line, the accuracy note, "How it works", "Stats through". Warns when the player averages <15 min (outside the training filter).
- Spot checks (Nov 8 data): Luka 32.6 vs ATL (season 38.3: still blended with last season 8 games in), +0.9 with Reaves out; SGA 29.6, +0.9 with Jalen Williams out; Jaylin Williams (bench) 5.3.
- Deploy prep: `app/requirements.txt` (pinned: scikit-learn==1.9.1, streamlit, pandas, numpy, joblib, altair; Streamlit Cloud reads the one next to the entrypoint). Tested in a clean venv with only those. `.gitignore` excludes data/raw/ and features.csv (80 MB on disk; the app doesn't need them). On Streamlit Cloud pick Python 3.12, entrypoint `app/streamlit_app.py`.
- Stale data: the app predicts from whatever data/site has. Run ./refresh.sh before demoing (rest days and recent form are off if it's days old).

## API (built Nov 8)

Run it: `source .venv/bin/activate && uvicorn api.main:app --reload` -> interactive docs at http://localhost:8000/docs.
Tests: `pytest api/tests -s` (needs `pip install -r api/requirements-dev.txt`; the match-test check needs data/raw).

Files: `api/main.py` (routes, CORS, errors -> 400), `api/engine.py` (all logic, loaded once at startup), `api/requirements.txt` (pinned, scikit-learn==1.9.1), `api/Dockerfile` (build from project root: `docker build -f api/Dockerfile .`; port $PORT, default 7860 for HF Spaces), `.dockerignore`. Docker isn't installed on the laptop, so the image hasn't been built yet; the pinned requirements were tested in a clean venv (all tests pass).

- CORS: http://localhost:3000 always; more via env var `CORS_ORIGINS` (comma-separated, e.g. the Vercel URL).
- Bad input -> 400 with a `detail` message: unknown player/team, opponent = his own team, bad date (must be after stats-through and in the current season), the player himself in an out list, missing/wrong-type params.
- `date` is optional everywhere; default = today or the day after stats-through, whichever is later.

Endpoints:
- `GET /health`, `GET /meta` (season, stats_through, test MAE 4.86 vs 5.24, % within 3/5, % off 10+, default_date, days_since_stats, stale_days + stale_warning for the default date, likely-range offsets).
- `GET /players` (id, name, team, games, ppg, mpg, last5_ppg), `GET /teams?date` (blended def rating + pace going into that date, ranks: 1 = toughest D / fastest).
- `GET /rotations?player_id&opp_id&date&home` (tonight_rotations; `still_on_team=false` = traded away, already counted out; `missed_last_team_game` hint).
- `POST /predict {player_id, opp_id, date, home, team_out_ids, opp_out_ids}`: prediction (unrounded, = predict_points(pregame_features(...)) exactly), prediction_everyone_playing, likely_range, key_numbers, breakdown, all 33 features, stale_days + stale_warning.
- Stale data (added Nov 8, display only, no math change): `stale_days` = game date minus stats_through; `stale_warning` is set when it's > 2: "Stats are N days old, so rest and recent form may be off. Refresh the data for accurate predictions." Tested in `test_stale_days`.
- `GET /sweep?player_id&date&home`: all 29 opponents, sorted, nobody out. Also `blended_avg` (his pts_blend going in, for the site's reference line; added Nov 8, no math change, tested against /predict).
- `GET /history?player_id`: this season's games (date, opp, pts, min, tsa) + games vs each opponent this season and last.
- `GET /model-stats`: `data/site/model_stats.json`.

How the pieces work:
- Likely range: prediction + [20th, 80th percentile] of (actual - predicted) on the 2025-26 test set for his tier by pts_blend (<10 / 10-20 / 20+). Middle 60% of real misses. Offsets: <10 -3.9/+4.6, 10-20 -5.6/+5.4, 20+ -6.6/+6.1. Written by `build_site_data.py` -> `data/site/error_bands.json`.
- Breakdown ("why this number", labeled approximate): start from a neutral row = "his baseline", add groups back in a fixed order (opponent, schedule, players out, home, form, matchup), re-predicting after each. Steps add up exactly to the prediction (telescoping). Neutral values: opponent = league average of the blended team ratings on that date (net_rtg_gap = his team vs an average team); schedule = his most common rest_days / games_last_7 this season; players out = 0; HOME = average of home and away predictions; form = pts_l3/5/10 -> pts_blend, min_l3/5/10 -> min_blend, tsa_l5 -> tsa_season, ts_hot and min_trend -> 0, starter_proxy -> (min_blend >= 28) (included in form because it's computed from min_l5); matchup = 0.
- Sweep speed (0.2 s vs ~6 s for 29 full runs): only 7 features change with the opponent (opp_def_rtg, opp_pace, opp_pts_allowed, net_rtg_gap, abs_net_rtg_gap, opp_missing_min, pts_vs_opp_rel). One normal pregame pass, then those 7 for all teams in one go with the training functions: a fake "every team plays tonight" slate through build_team_features + missing_rotation_minutes, and add_matchup_history on his past games plus one tonight row per opponent. Test checks all 29 opponents' features == full pregame_features runs (exact).
- Measured (Nov 8, laptop): startup 1.0 s; /predict 0.23 s (0.46 s with players out: it also computes the everyone-playing number); /sweep 0.21 s (0.32 s first call on a new date).
- `src/build_model_stats.py` (refresh.sh step 4) -> `data/site/model_stats.json` (~280 KB): test results table, MAE by month / tier / role (match the notebook), 2,000-game predicted-vs-actual sample, floor (5.252 / 4.871 / 4.177, constants from the notebook), permutation importance of the final model on the test set (cached in `results/test_permutation_importance.csv`; top: pts_blend 1.35, tsa_l5 0.21, pts_l10 0.10, team_missing_min 0.10), live 2026-27 tracker by week (deploy model 4.908 vs pts_l5 5.485 through Nov 2).
- Hosting notes: free tiers sleep when idle (Render free spins down after ~15 min, slow first request), so wake the API before the demo. HF Spaces needs the Dockerfile at the Space's repo root.

## Front end (built Nov 8)

Run it (two terminals): `source .venv/bin/activate && uvicorn api.main:app --reload` (project root), then `cd web && npm run dev` -> http://localhost:3000. Node 26 was installed with Homebrew on Nov 8 (`brew install node`); first time in `web/`: `npm install`.
Checks: `npm run lint`, `npm run build` (all pages prerender as static), `npm run screenshots` (needs both servers). The screenshot script loads all 4 pages at desktop (1440) and phone (390) in dark and light (24 screenshots in `web/screenshots/`). It fails on leftover skeletons, error cards, console errors, sideways scroll on a phone, or any serious/critical axe accessibility problem (contrast, labels, ARIA). It also checks: star / bench / teammate switched off, Cmd+K, 3 keyboard switch flips = 1 request, Copy link reopens the same matchup, a vs Every Team bar click opens that matchup, the 29-row table, sidebar links keep the player, the 404 page, and the cold-start message.

Stack: Next.js 16.4 (App Router, `cacheComponents` on), TypeScript, Tailwind 4, shadcn/ui (Radix base, Nova preset), Recharts 3 styled like Tremor Raw, React Bits SpotlightCard + CountUp, SWR, next-themes (dark by default). API URL from `NEXT_PUBLIC_API_URL` (default http://localhost:8000, see `web/.env.example`). No team logos or headshots: team abbreviations and player initials only. No em dashes in UI text.

- Layout: collapsible sidebar (Matchup, vs Every Team, Model Performance, How It Works; footer shows test MAE), top bar (Cmd+K player search, "Stats through <date>", light/dark toggle), banners under it: "Waking up the model..." when any request takes > 3 s (cold start), and the API's stale warning (the Matchup page's date overrides /meta's).
- Matchup page (`web/src/components/matchup/`, wired in `matchup-page.tsx`): controls (player via Cmd+K, opponent, home/away, date), Copy link button -> hero (CountUp number, likely-range band, "Everyone playing: Z", usual minutes (his blended average, not a minutes prediction) / rest / tier, all 6 factors as small diverging bars) -> who's out (switch per rotation player, live update, "+0.9 with Reaves out") -> 4 KPI cards with sparklines -> "why this number" waterfall (hover = feature values vs neutral) -> opponent card (plain-word ranks) -> recent form chart (points / minutes / shots, season avg line, dashed prediction) -> history vs this opponent.
- State lives in the URL (`?player=&opp=&home=1|0&date=&out=&oout=`), read by `web/src/lib/use-selection.ts` (shared by Matchup and vs Every Team). Once defaults are resolved, the full set is written back into the URL, so Copy link always gives a complete link (tested: reopens the same number, side and players out). Sidebar links carry player / opponent / home / date between the two pages. Switch flips are debounced 350 ms (3 quick flips = 1 /predict call, checked by the screenshot script). Fast-click bug fixed: toggles read the out list from the URL, not the last render.
- All numbers come from the API; the site does no prediction math. Checked Nov 8: Luka vs ATL home 32.6, with Reaves out 33.5 (+0.9), range 26.9 to 39.6, same as calling /predict directly.
- History card: "vs his usual" is the pts_vs_opp_rel feature value (Luka vs ATL -4.9), but its effect on the prediction is ~0 (waterfall step 0.0). The card says so. Good presentation point: the model learned past meetings barely predict the next one (matches its ~0 permutation importance).
- Vendored code edits: React Bits SpotlightCard uses cn() class merging and sets its settings ref in useLayoutEffect; shadcn `use-mobile` uses useSyncExternalStore (both for the React 19 lint rules). shadcn's new `CommandDialog` doesn't wrap children in `<Command>`, so `player-search.tsx` does.
- vs Every Team (`web/src/components/sweep/sweep-page.tsx`, /sweep + /history): same player / home / date controls, 4 summary cards (best, toughest, spread, blended average), horizontal bar chart of all 29 opponents best to toughest (3 best green, 3 toughest red, dashed line at his blended average, zoomed axis with a note), click a bar -> Matchup with that opponent. Table view: rank, opponent, prediction + range, defense rank, pace rank, his history vs them. Note: for Luka on Nov 8 every opponent is below his blended average (35.5) because recent form and rest pull him down; the chart shows that honestly.
- Model Performance (`web/src/components/performance/performance-page.tsx`, /model-stats): KPIs (test MAE 4.86, last-5 rule 5.24, 60% within 5, live 2026-27 4.91), every model on the test season, how-we-tested timeline, error by month / tier / role, predicted vs actual scatter (2,000 games, diagonal), "how low can it go" (5.25 / 4.87 / 4.18 cheating model), top 12 feature importance bar list, live tracker by week. Each chart has a one-paragraph plain-words takeaway.
- How It Works (`web/src/app/how-it-works/page.tsx`, static, no API): 8 sections (question, data, features in 5 groups that add up to 33, leakage tests, models tried + what didn't help, accuracy, limitations, credits with the personal site link, a GitHub placeholder and the AI-use note), with an "On this page" nav on wide screens.
- Polish: `template.tsx` fades each page in (off for reduced motion), `not-found.tsx` 404, title template "<page> | NBA Points Predictor", text favicon `icon.tsx` / `apple-icon.tsx` ("PP" on blue), share image `opengraph-image.tsx` (text + simple bars, no logos). Shared page pieces in `web/src/components/page-shell.tsx` (PageHeader, CopyLinkButton, ApiErrorCard, Takeaway); zoomed axes use `niceDomain()` in `charts.tsx` for even ticks.
- Colors (globals.css): `brand` (charts), `brand-ink` (blue text), `brand-solid` (blue behind white text), `pos` / `neg` / `pred`. Light mode uses darker pos/neg/pred and muted-foreground so text passes 4.5:1 contrast (axe found these Nov 8 and they were fixed).
- Vercel: set the project root to `web/`, env vars `NEXT_PUBLIC_API_URL` = hosted API URL and `NEXT_PUBLIC_SITE_URL` = the Vercel URL (for absolute share-image links), and add the Vercel URL to the API's `CORS_ORIGINS`.

## Known limitations (say these openly)

- No pregame injury news. Foul trouble is random. Blowouts, rest, and rotation changes are only partly predictable. Pros have news feeds; this model doesn't.
- Site feature to offset it: user checks off who's out tonight and the prediction updates.

## Stretch goals (after the core works)

- Game score: sum player predictions (bottom-up) vs a direct team points model (top-down).

## How to work with Ethan

- Casual, direct, short. No em dashes.
- He's a vibe coder: keep momentum, but explain each piece in plain terms so he can defend it in the presentation.
- Keep him on track against the deadlines. When he asks what's next, give the single next step.
- Priority: class requirements first, site second, stretch goals last.
