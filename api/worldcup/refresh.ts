import { methodNotAllowed, sendJson, serverError } from "../_lib/http.js";
import { fetchFixtures, fetchResults } from "./sources.js";
import { applyGrade, findResult } from "./grade.js";
import { getClosingLines } from "./odds.js";
import { buildTeamForm } from "./form.js";
import { predictMatch } from "./predict.js";
import {
  getPredictions,
  getResults,
  setFixtures,
  setMeta,
  setPrediction,
  setResult,
} from "./store.js";
import type { Match, MatchResult, Prediction, WorldCupMeta } from "./types.js";

// Opus predictions take ~30-50s each; default Vercel timeout is 10s, so raise it.
// Hobby max is 60s (Pro allows up to 300s — raise WORLDCUP_MAX_PREDICTIONS there).
export const maxDuration = 60;

// On-demand refresh (no cron). The page calls this; it is CACHE-FIRST:
//   - predictions already in Redis for day-range matches are reused (no Claude)
//   - only uncached in-range matches are generated (capped per call)
//   - finished matches are graded (free) and accuracy recomputed
// Cost is bounded by the cache: once a match is predicted it's never re-billed.

const CODED_TEAM = /^(\d[A-Z]|[WL]\d+)$/i;

function kickoffMs(m: Match): number | null {
  return m.kickoffUtc ? new Date(m.kickoffUtc).getTime() : null;
}

// PST calendar date (YYYY-MM-DD) — the tournament's host-time "matchday".
function pstDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

// Hour of day (0–23) in California time.
function pstHour(ms: number): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  return parseInt(h, 10) % 24; // midnight can format as "24"
}

function buildRecentContext(
  fixtures: Match[],
  results: Record<string, MatchResult>,
): string {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  return Object.values(results)
    .sort((a, b) => a.gradedAt.localeCompare(b.gradedAt))
    .slice(-10)
    .map((r) => {
      const f = byId.get(r.matchId);
      return f ? `${f.team1} ${r.homeScore}-${r.awayScore} ${f.team2}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET" && req.method !== "POST") {
    return methodNotAllowed(res, ["GET", "POST"]);
  }

  try {
    const now = Date.now();

    const fixtures = await fetchFixtures();
    await setFixtures(fixtures);
    const ids = fixtures.map((m) => m.id);

    const [results, predictions] = await Promise.all([
      getResults(ids),
      getPredictions(ids),
    ]);

    // Grade newly-finished matches (free). Closing odds (if captured) let us
    // grade the market's pick alongside the model's for the track record.
    let newlyGraded = 0;
    try {
      const [raw, closing] = await Promise.all([fetchResults(), getClosingLines()]);
      for (const f of fixtures) {
        if (results[f.id]) continue;
        const k = kickoffMs(f);
        if (k === null || k > now) continue;
        const found = findResult(f, raw);
        if (!found) continue;
        const graded = applyGrade(found, predictions[f.id], closing[f.id]);
        await setResult(graded);
        results[f.id] = graded;
        newlyGraded++;
      }
    } catch {
      /* results source flaky — continue */
    }

    // Predict TODAY and TOMORROW's matches (by PST matchday) so the UI always
    // has the next two days ready — tomorrow's are generated a day ahead.
    // Cache-first: already-cached or finished matches are skipped (no Claude).
    // Generate only a few per call to stay within the serverless timeout; the
    // page re-triggers until none remain.
    const recentContext = buildRecentContext(fixtures, results);
    const todayPst = pstDate(now);
    const tomorrowPst = pstDate(now + 24 * 60 * 60 * 1000);
    const targetDays = new Set([todayPst, tomorrowPst]);
    const todayUncached = fixtures
      .filter((f) => {
        if (!f.kickoffUtc) return false;
        if (predictions[f.id] || results[f.id]) return false; // cache-first
        if (CODED_TEAM.test(f.team1.trim()) || CODED_TEAM.test(f.team2.trim()))
          return false;
        return targetDays.has(pstDate(new Date(f.kickoffUtc).getTime()));
      })
      // Today's matches first (sooner kickoff), then tomorrow's.
      .sort((a, b) => (a.kickoffUtc as string).localeCompare(b.kickoffUtc as string));
    // Per-call cap: 1 fits one Opus prediction in <60s (Hobby). Raise on Pro.
    const perCall = Number(process.env.WORLDCUP_MAX_PREDICTIONS || "1");
    // Only generate after 7am PST (configurable). This is what makes next-day
    // matches get predicted "the morning before" rather than overnight; before
    // the cutoff we still serve cache + grade, just don't spend on new ones.
    const genStartHour = Number(process.env.WORLDCUP_GEN_START_HOUR_PST || "7");
    const genAllowed = pstHour(now) >= genStartHour;
    const toPredict = genAllowed ? todayUncached.slice(0, perCall) : [];

    let newlyPredicted = 0;
    const predictErrors: string[] = [];
    for (const f of toPredict) {
      try {
        const teamForm = await buildTeamForm(f, fixtures, results);
        const pred: Prediction = await predictMatch(f, { lang: "zh", recentContext, teamForm });
        await setPrediction(pred);
        predictions[f.id] = pred;
        newlyPredicted++;
      } catch (e) {
        predictErrors.push(`${f.id}: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    // Recompute accuracy (model + market)
    let graded = 0;
    let outcomeHits = 0;
    let exactHits = 0;
    let marketGraded = 0;
    let marketHits = 0;
    for (const id of ids) {
      const r = results[id];
      if (!r) continue;
      graded++;
      if (r.outcomeHit) outcomeHits++;
      if (r.exactHit) exactHits++;
      if (r.marketHit != null) {
        marketGraded++;
        if (r.marketHit) marketHits++;
      }
    }

    const meta: WorldCupMeta = {
      lastSyncAt: new Date().toISOString(),
      fixturesCount: fixtures.length,
      predictionsCount: Object.keys(predictions).length,
      resultsCount: graded,
      accuracy: { graded, outcomeHits, exactHits, marketGraded, marketHits },
    };
    await setMeta(meta);

    return sendJson(res, 200, {
      ok: true,
      fixturesCount: fixtures.length,
      newlyGraded,
      newlyPredicted,
      predictionsCount: meta.predictionsCount,
      // Uncached matches still in the today+tomorrow window — the page
      // re-triggers /refresh while this is > 0 (and progress is being made).
      // 0 before the 7am PST cutoff so the page doesn't loop pointlessly.
      remaining: genAllowed ? todayUncached.length - newlyPredicted : 0,
      predictErrors,
    });
  } catch (error) {
    return serverError(res, error);
  }
}
