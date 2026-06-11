# worldcup-web — 2026 FIFA World Cup · AI Forecast

Standalone app (its own repo + Vercel project + domain, like `guandan-web`).
Schedule + daily AI match predictions + prediction-vs-result record. Bilingual
(zh-first), FIFA 2026 palette. No dependency on the celestial app.

## Stack
React 18 + Vite + Tailwind. Serverless functions under `api/` (Vercel Node).
Predictions: Claude **Opus 4.8** with adaptive thinking. Storage: Upstash Redis.
Data: openfootball (fixtures, free) + TheSportsDB (results, free).

## Env vars (set in the Vercel project)
| Var | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude key |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash REST token |
| `WORLDCUP_MAX_PREDICTIONS` | — | predictions generated per `/refresh` call (default 1; raise on Vercel Pro) |
| `WORLDCUP_WEB_SEARCH` | — | `1` to enable live-odds web research (slower, costlier); default off |
| `THESPORTSDB_KEY` | — | default `3` |
| `API_FOOTBALL_KEY` | — | live-score source (free key from dashboard.api-sports.io); falls back to the free worldcup26.ir feed if unset |

Locally, put these in `worldcup/.env.local` (gitignored).

## Develop
```
cd worldcup
npm install
npm run dev          # http://localhost:8090  (api/* served by the dev middleware)
```
Trigger generation/grading: `curl http://localhost:8090/api/worldcup/refresh`

## How it works
- `GET /api/worldcup/data` — fixtures (live-fetched + cached if Redis empty) + cached predictions/results. Fast, free.
- `GET /api/worldcup/refresh` — cache-first; generates today's (PST) uncached matches, a few per call (timeout-bounded, the page re-triggers until done), grades finished matches, updates accuracy. `maxDuration = 60` is set in the function.
- The page calls `/refresh` on load; predictions are generated once per PST day per match, then served from cache.

## Deploy (Vercel)
1. New Vercel project from this repo (Framework: Vite).
2. Add the env vars above (Production + Preview).
3. Add the domain (e.g. `worldcup.mingqi.me`).
4. Push to `main` → deploys.

## Teardown
Delete the Vercel project + repo; remove the external link from the celestial app's nav. Flush Redis with the `worldcup:` prefix.
