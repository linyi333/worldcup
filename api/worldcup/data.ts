import { methodNotAllowed, sendJson, serverError } from "../_lib/http.js";
import { fetchFixtures } from "./sources.js";
import {
  getFixtures,
  getMeta,
  getPredictions,
  getResults,
  setFixtures,
} from "./store.js";

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

    res.setHeader("Cache-Control", "public, max-age=300");
    return sendJson(res, 200, { fixtures, predictions, results, meta });
  } catch (error) {
    return serverError(res, error);
  }
}
