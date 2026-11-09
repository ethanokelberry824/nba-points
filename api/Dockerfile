# NBA Points Predictor API. Build from the PROJECT ROOT (it needs src/, models/, data/site/):
#     docker build -f api/Dockerfile -t nba-points-api .
#     docker run -p 7860:7860 nba-points-api          -> http://localhost:7860/docs
# Render: set "Dockerfile Path" to api/Dockerfile (it sets $PORT itself).
# Hugging Face Spaces (Docker SDK): the Space wants a Dockerfile at its repo root, so copy
# this file there (paths stay the same); Spaces serves port 7860.
# Extra CORS origins (the Vercel site): set env var CORS_ORIGINS="https://x.vercel.app".
FROM python:3.12-slim

WORKDIR /app
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY src/ src/
COPY models/deploy_model.joblib models/deploy_model.joblib
COPY data/site/ data/site/
COPY api/__init__.py api/engine.py api/main.py api/

# Spaces runs the container as a non-root user; everything here is read-only anyway
ENV PORT=7860 PYTHONUNBUFFERED=1
EXPOSE 7860
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
