import { methodNotAllowed, sendJson, serverError } from "../_lib/http.js";
import { fetchFixtures } from "./sources.js";
import { fetchLiveScores } from "./live.js";
import { getChampionOdds, getMatchValues } from "./odds.js";
import {
  getFixtures,
  getMeta,
  getPredictions,
  getResults,
  setFixtures,
} from "./store.js";
import type { ChampionOdd, LiveScore, ValueAnalysis } from "./types.js";

// Read-only endpoint the page fetches. Predictions/results come from Redis
// (filled by the cron — the paid part). Fixtures are free, so if Redis has none
// yet we fetch them live and cache them, so the schedule always shows without
// waiting for the cron.
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  try {
    let fixtures = await getFixtures();
    if (fixtures.length === 0) {
      try {
        fixtures = await fetchFixtures();
        await setFixtures(fixtures); // best-effort cache
      } catch {
        /* source flaky — return whatever we have */
      }
    }
    const ids = fixtures.map((m) => m.id);
    const [predictions, results, meta] = await Promise.all([
      getPredictions(ids),
      getResults(ids),
      getMeta(),
    ]);

    // Optional live scores (display-only). Only bother hitting the feed when a
    // match is actually in its live window (kickoff within the last ~2.75h and
    // not yet finished) — avoids paying the feed's latency on every request.
    const now = Date.now();
    const LIVE_WINDOW_MS = 165 * 60 * 1000;
    const inPlay = fixtures.filter((f) => {
      if (results[f.id] || !f.kickoffUtc) return false;
      const k = new Date(f.kickoffUtc).getTime();
      return !Number.isNaN(k) && k <= now && now - k <= LIVE_WINDOW_MS;
    });
    let live: Record<string, LiveScore> = {};
    if (inPlay.length > 0) {
      try {
        live = await fetchLiveScores(inPlay);
      } catch {
        /* live feed optional */
      }
    }

    // Model-vs-market value analysis for matches with both a prediction and
    // odds. Best-effort, throttled inside; {} when no odds key / feed down.
    let value: Record<string, ValueAnalysis> = {};
    let champions: ChampionOdd[] = [];
    try {
      value = await getMatchValues(fixtures, predictions);
    } catch {
      /* odds optional */
    }
    try {
      champions = await getChampionOdds();
    } catch {
      /* champion odds optional */
    }

    // Shorter cache while something is live so the score doesn't go too stale.
    const hasLive = Object.keys(live).length > 0;
    res.setHeader("Cache-Control", `public, max-age=${hasLive ? 60 : 300}`);
    return sendJson(res, 200, { fixtures, predictions, results, live, value, champions, meta });
  } catch (error) {
    return serverError(res, error);
  }
}
