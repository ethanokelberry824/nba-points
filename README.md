# NBA Player Points Predictor

Intro to AI final project (CSUSM, Fall 2026). Predicts how many points an NBA player scores against a given opponent, using a two-stage model (minutes first, then points).

## Setup (Mac)

```bash
cd nba-points
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Step 1: pull the data

```bash
python src/pull_data.py
```

Saves player and team game logs for 2022-23 through 2026-27 to `data/raw/` (2022-23 is history only: it feeds last-season averages and matchup history, but isn't in the feature table). Re-run with `--refresh` to update the current season.

## Step 2: build features

```bash
python src/build_features.py
```

Builds `data/processed/features.csv`: one row per player per game, 31 leak-free features (only past games), targets `PTS` and `MIN`.

## Layout

```
data/raw/        raw CSVs straight from nba_api (don't edit)
data/processed/  cleaned + feature tables
notebooks/       EDA and modeling notebooks
src/             scripts
api/             FastAPI backend for the Next.js site
app/             Streamlit site (backup)
```

## The site

```bash
./refresh.sh                        # pull new games, rebuild features + data/site/, run the match test
streamlit run app/streamlit_app.py  # opens http://localhost:8501
```

`python src/check_pregame.py` proves the site's features match the training features exactly.

## The API (for the Next.js site)

```bash
pip install -r api/requirements-dev.txt
uvicorn api.main:app --reload       # http://localhost:8000/docs for interactive docs
pytest api/tests -s                 # tests + response times
```

Next.js front end -> FastAPI (`api/`) -> `src/pregame.py` (same feature code as training) -> `src/predict.py` (deploy model).
Extra CORS origins: `CORS_ORIGINS="https://your-site.vercel.app"`. Docker: `docker build -f api/Dockerfile -t nba-points-api .`
