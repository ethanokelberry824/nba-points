# NBA Points Predictor: front end

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. Talks to the FastAPI backend in `../api`.

## Run it locally

Two terminals:

```bash
# 1. the API (project root)
source .venv/bin/activate && uvicorn api.main:app --reload     # http://localhost:8000

# 2. the site (this folder)
npm install          # first time only
npm run dev          # http://localhost:3000
```

The API URL comes from `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`, see `.env.example`).

## Checks

```bash
npm run lint
npm run build
npm run screenshots   # needs both servers running; drives the real site with Playwright
```

`npm run screenshots` loads the Matchup page for the top scorer, a bench player, and the top
scorer with a teammate switched off, at desktop (1440 wide) and phone (390 wide) sizes. It fails if
any section is still loading, shows an error, the page scrolls sideways on a phone, or the
browser logs an error. It also checks the Cmd+K search, that 3 quick switch flips send 1 request,
and the "waking up" message when the API is slow. Screenshots land in `screenshots/`.

## Layout

- `src/app/`: pages. `/` is Matchup; the other three are placeholders for now.
- `src/components/matchup/`: one file per Matchup section; `matchup-page.tsx` wires them together.
- `src/components/ui/`: shadcn/ui components. `CountUp.tsx`, `SpotlightCard.tsx`: React Bits.
- `src/lib/api.ts`: types for every endpoint, fetch wrapper, slow-request (cold start) tracker.
- `src/lib/hooks.ts`: SWR hooks, one per endpoint.

No prediction math happens here. Every number comes from the API.
