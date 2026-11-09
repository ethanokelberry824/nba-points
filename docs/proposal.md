# Final Project Proposal: Predicting NBA Player Points

Oct 30, 2026 · Ethan Okelberry

## Motivation

I want to predict how many points an NBA player will score against a specific opponent on a specific night. I follow the NBA closely, so this is a problem I actually understand and care about, which should make the feature engineering and the analysis a lot better.

This kind of prediction is used all the time in the real world. Fantasy sports sites, sportsbooks, and team analytics departments all build player projections, and most of them start the same way: figure out how many minutes a player will get, then figure out how much he scores in those minutes, then adjust for the opponent. I want to build my own version of that and see how close a student project can get.

My end goal is to turn the model into a simple public web app where anyone can pick a player and an opponent and see the prediction. I plan to have it live by the final presentation.

## Dataset

I'm building my own dataset from official NBA box scores using [nba_api](https://pypi.org/project/nba-api/), a free Python library that pulls data from stats.nba.com with no API key. I'll start with player game logs and team stats from the last three full regular seasons (2023-24, 2024-25, and 2025-26), and pull up to eight seasons so I can test whether more history helps.

Each row is one player in one game. A regular season has 1,230 games, and after filtering to players who average at least 15 minutes, I expect roughly 18,000 to 20,000 rows per season, so around 55,000 to 60,000 rows for three seasons and roughly 140,000 for eight. I'll confirm the exact count after the data pull.

The raw game logs have about 25 columns (minutes, points, field goal and free throw attempts, rebounds, assists, home or away, opponent, date, and so on). From those I'll build around 20 features for the model:

| Group | Features |
| --- | --- |
| Player form | Season points per game, points average over the last 3, 5, and 10 games, minutes averages over the same windows, average FGA, 3PA, and FTA, recent minutes trend |
| Role and context | Starter or bench, home or away, days of rest, back-to-back, games in the last 7 days, games since returning from an absence |
| Teammates | Minutes from the usual rotation that are missing tonight |
| Opponent | Opponent defensive rating, opponent pace, opponent points allowed, net rating gap between the two teams |

The target is the number of points the player scores in that game.

## Problem Type and Metrics

This is a regression problem, since the target (points scored) is a number and not a category. Because it isn't classification, there's no class distribution to report, but I'll show the distribution of points per game during EDA.

My main metric is mean absolute error (MAE), because it's easy to explain: it's how many points the prediction is off by on average. I'll also report RMSE, which punishes big misses more, and R².

To know if the model is actually useful, I'll compare everything against a simple baseline: predicting each player's average points over his last 5 games. If a model can't beat that, it isn't adding anything.

## Exploratory Data Analysis Plan

I'll follow the same EDA steps we used in the California housing example, adapted to basketball:

- Use info() and describe() to check data types, missing values, and the range of each column.
- Plot histograms of points and minutes. I expect points to be right-skewed, since most players score 5 to 20 and only a few score 40 or more.
- Build a correlation matrix to see which features line up most with points. I expect minutes and recent scoring averages to be at the top.
- Make scatter plots of minutes vs points and last-5 average vs points to see how strong those relationships really are.
- Compare average points at home vs away and on rest vs back-to-backs.
- Check how much a player's points swing from game to game, which tells me how much error is realistic.

## Pre-processing and Feature Engineering

Most of the work in this project is feature engineering, since the raw game logs only tell you what happened, not what was expected before the game.

- **Rolling features:** I'll compute rolling averages (last 3, 5, and 10 games) for points, minutes, and shot attempts. Every rolling feature will only use games before the one being predicted, so the model never sees the answer.
- **Joining opponent stats:** I'll merge team stats (defensive rating, pace, points allowed) onto each row based on the opponent.
- **Derived features:** rest days and back-to-back from game dates, starter or bench from the box score, and missing rotation minutes from which regular players didn't play.
- **Filtering:** I'll drop games where a player played under 5 minutes, since those are usually injuries or garbage time and would add noise.
- **Missing values:** a player's first few games of a season won't have full rolling windows. I'll fill those with the median using SimpleImputer, fit on the training set only.
- **Encoding:** home or away and starter or bench become 0/1 flags. If I use opponent team as a feature, I'll one-hot encode it.
- **Scaling:** I'll standardize numeric features with StandardScaler for Ridge regression. Tree models don't need it, but keeping everything in one sklearn Pipeline with a ColumnTransformer keeps it consistent.

## Method

I'll compare two algorithms: **Ridge regression** as the simple linear model, and **gradient boosting** (HistGradientBoostingRegressor in sklearn) as the more powerful nonlinear model. If gradient boosting gives me trouble, Random Forest is my backup.

I'll also test two ways of setting up the problem, based on how real projection systems work:

- **One-stage:** predict points directly from all the features.
- **Two-stage:** first train a model to predict the player's minutes, then train a second model to predict points using the predicted minutes as one of its features. Minutes are the biggest driver of scoring, so giving the model a good minutes estimate should help. To keep this honest, the points model will be trained on out-of-fold predicted minutes (using cross_val_predict), not the actual minutes from the box score.

That gives me a clean comparison for the presentation: the last-5 baseline vs one-stage vs two-stage, each run with Ridge and gradient boosting.

**Hyperparameters I plan to tune:**

| Model | Hyperparameters |
| --- | --- |
| Ridge | alpha (regularization strength) |
| Gradient boosting | learning_rate, max_iter (number of trees), max_depth, min_samples_leaf |
| Random Forest (backup) | n_estimators, max_depth, max_features |

**Validation:** I'll split by date instead of randomly, since in real life you only ever predict future games from past ones. I'll hold out 2025-26 as the test set and start by training on 2023-24 and 2024-25. Since scoring and pace have changed a lot over the last decade, I'll also retrain on longer windows (3, 5, and 8 seasons of data total) and compare MAE on the same test set to see whether more history helps or whether recent seasons matter more. For tuning, I'll use cross-validation with TimeSeriesSplit inside GridSearchCV or RandomizedSearchCV, so each fold validates on games that come after the ones it trained on. The test set gets used once at the very end.

## Anticipated Challenges

- **Data leakage:** rolling stats are easy to get wrong. If a game's own points sneak into its "last 5 average," the model will look amazing in testing and be useless in real life. I'll shift every rolling feature by one game and double check it.
- **Things the data can't see:** injuries announced the day of the game, foul trouble, blowouts where starters sit, and coaches changing the rotation all affect minutes, and minutes drive points. Real projection sites adjust for injury news before tip-off, and my model won't have that. I can partly capture it with features like missing rotation minutes and the net rating gap, but some misses will just be random.
- **Noise in scoring:** even a perfect model can't predict a hot or cold shooting night, so there's a limit on how low MAE can go. The baseline comparison will show how much the model actually adds.
- **Pulling the data:** stats.nba.com throttles fast requests and blocks some cloud servers, so I'll pull the data on my own laptop with delays between calls and save it to CSV.
- **Small matchup samples:** a player only faces each team 2 to 4 times a season, so "how he did against this team before" is probably too noisy to help. I'll test it as a feature instead of assuming it works.

## Stretch Goals

- **Web app:** a Streamlit site where anyone picks a player and an opponent and sees the predicted points, with an option to mark which players are out tonight so the prediction adjusts. I plan to use it as the live demo in my presentation.
- **Game score prediction:** if time allows, I'll add up player predictions to get a team score and compare that against a simpler model that predicts team points directly.

## AI Use

I used Claude to brainstorm the project idea, research how professional NBA projection models are built, and help draft this proposal. I'll keep using it for coding and debugging, and I'll disclose that use and include transcripts with my final submission.
