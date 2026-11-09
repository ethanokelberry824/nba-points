"""
NBA Points Predictor API (FastAPI). The Next.js site calls this; the Streamlit app is the backup.

    uvicorn api.main:app --reload          (from the project root)
    open http://localhost:8000/docs        (interactive docs: try every endpoint)

Architecture: Next.js front end -> this API -> src/pregame.py (features, same code as
training) -> src/predict.py (deploy model). Data comes from data/site/ (./refresh.sh).
Everything is loaded once at startup (api/engine.py), not per request.

CORS: http://localhost:3000 is always allowed. Add more (the Vercel site) with
    CORS_ORIGINS="https://your-site.vercel.app,https://www.yoursite.com"
"""

import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from api.engine import BadInput, Engine

engine: Engine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    t = time.perf_counter()
    engine = Engine()
    print(f"loaded data/site + deploy model in {time.perf_counter() - t:.1f}s "
          f"(stats through {engine.meta['stats_through']})")
    yield


app = FastAPI(
    title="NBA Points Predictor API",
    description="Predicts how many points an NBA player scores against a given opponent. "
                "Intro to AI final project, CSUSM, Fall 2026.",
    version="1.0",
    lifespan=lifespan,
)

origins = ["http://localhost:3000"] + [
    # rstrip("/"): browsers send the origin with no trailing slash, so a pasted
    # "https://x.vercel.app/" would never match
    o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
                   allow_headers=["*"])


# ---------------------------------------------------------------- errors -> 400

@app.exception_handler(BadInput)
async def bad_input(request: Request, exc: BadInput):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(RequestValidationError)
async def bad_params(request: Request, exc: RequestValidationError):
    """Missing / wrong-type parameters: 400 with a readable message (FastAPI's default is 422)."""
    msgs = [f"{'.'.join(str(x) for x in e['loc'] if x not in ('query', 'body'))}: {e['msg']}"
            for e in exc.errors()]
    return JSONResponse(status_code=400, content={"detail": "; ".join(msgs) or "bad request"})


# ---------------------------------------------------------------- endpoints

DATE_HELP = "YYYY-MM-DD, after the stats-through date (default: today, or the day after the stats)"


@app.get("/health", tags=["info"])
def health():
    return {"status": "ok", "stats_through": engine.meta["stats_through"]}


@app.get("/meta", tags=["info"])
def meta():
    """Season, stats-through date, and the test-set accuracy the site shows."""
    return engine.meta_info()


@app.get("/players", tags=["lists"])
def players():
    """Every player who has played this season, for the search box."""
    return engine.players_list()


@app.get("/teams", tags=["lists"])
def teams(date: str | None = Query(None, description=DATE_HELP)):
    """Teams with blended defensive rating and pace going into `date`, and league ranks."""
    return engine.teams_list(date)


@app.get("/rotations", tags=["prediction"])
def rotations(player_id: int, opp_id: int, date: str | None = Query(None, description=DATE_HELP),
              home: bool = True):
    """Both teams' rotation players with usual minutes, for the who's-out toggles."""
    return engine.rotations(player_id, opp_id, date, home)


class PredictIn(BaseModel):
    player_id: int
    opp_id: int
    date: str | None = Field(None, description=DATE_HELP)
    home: bool = True
    team_out_ids: list[int] = Field(default_factory=list, description="his teammates sitting out")
    opp_out_ids: list[int] = Field(default_factory=list, description="opponents sitting out")

    model_config = {"json_schema_extra": {"examples": [{
        "player_id": 1629029, "opp_id": 1610612738, "date": None, "home": True,
        "team_out_ids": [], "opp_out_ids": []}]}}


@app.post("/predict", tags=["prediction"])
def predict(body: PredictIn):
    """Prediction, likely range, key numbers, and the "why this number" breakdown."""
    return engine.predict(body.player_id, body.opp_id, body.date, body.home,
                          body.team_out_ids, body.opp_out_ids)


@app.get("/sweep", tags=["prediction"])
def sweep(player_id: int, date: str | None = Query(None, description=DATE_HELP), home: bool = True):
    """His prediction against all 29 other teams (nobody out), best matchup first."""
    return engine.sweep(player_id, date, home)


@app.get("/history", tags=["player"])
def history(player_id: int):
    """His games this season, and his games vs each opponent this season and last."""
    return engine.history(player_id)


@app.get("/model-stats", tags=["info"])
def model_stats():
    """Precomputed numbers for the model performance page (src/build_model_stats.py)."""
    if engine.model_stats is None:
        return JSONResponse(status_code=503,
                            content={"detail": "model_stats.json missing: run src/build_model_stats.py"})
    return engine.model_stats
