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
| `WORLDCUP_GEN_START_HOUR_PST` | — | hour (0–23, California time) after which predictions start generating each day (default `7`) |
| `WORLDCUP_WEB_SEARCH` | — | `1` to enable live-odds web research (slower, costlier); default off |
| `THESPORTSDB_KEY` | — | default `3` |
| `API_FOOTBALL_KEY` | — | API-Football key (dashboard.api-sports.io). Its free tier has **no 2026 access**, so only used on a paid plan |
| `API_FOOTBALL_PAID` | — | `1` to use API-Football (paid) as the authoritative live+results source. Default off → free worldcup26.ir feed for live & grading, TheSportsDB as last-resort |

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
- `GET /api/worldcup/refresh` — cache-first; on any page load **after 7am PST** it checks today's **and tomorrow's** (PST) matches and generates any not already in Redis (so next-day matches are predicted the morning before), a few per call (timeout-bounded, the page re-triggers until done), grades finished matches, updates accuracy. `maxDuration = 60` is set in the function.
- The page calls `/refresh` on load; predictions are generated once per PST day per match, then served from cache.

## Deploy (Vercel)
1. New Vercel project from this repo (Framework: Vite).
2. Add the env vars above (Production + Preview).
3. Add the domain (e.g. `worldcup.mingqi.me`).
4. Push to `main` → deploys.

## Teardown
Delete the Vercel project + repo; remove the external link from the celestial app's nav. Flush Redis with the `worldcup:` prefix.
