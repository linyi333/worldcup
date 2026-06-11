import type { RawResult } from "./sources.js";
import type { Match, MatchResult, Prediction } from "./types.js";

// Team-name reconciliation between openfootball (fixtures) and TheSportsDB
// (results). Best-effort: normalize, strip diacritics, apply a small alias map.
// Unmatched matches simply stay ungraded (acceptable for a for-fun feature).
const ALIASES: Record<string, string> = {
  southkorea: "korea",
  korearepublic: "korea",
  unitedstates: "usa",
  us: "usa",
  czechrepublic: "czechia",
  ivorycoast: "cotedivoire",
  iranislamicrepublic: "iran",
  irian: "iran",
  capeverde: "caboverde",
  northmacedonia: "macedonia",
};

export function norm(name: string): string {
  const base = String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return ALIASES[base] || base;
}

// Does this result describe this fixture? Returns "direct" (home==team1),
// "swapped" (home==team2), or null (no match).
function orientation(fixture: Match, r: RawResult): "direct" | "swapped" | null {
  const t1 = norm(fixture.team1);
  const t2 = norm(fixture.team2);
  const rh = norm(r.home);
  const ra = norm(r.away);
  if (t1 === rh && t2 === ra) return "direct";
  if (t1 === ra && t2 === rh) return "swapped";
  return null;
}

function withinADay(fixtureDate: string, resultDate: string): boolean {
  if (!fixtureDate || !resultDate) return true; // don't over-filter
  const a = new Date(fixtureDate).getTime();
  const b = new Date(resultDate).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return Math.abs(a - b) <= 36 * 60 * 60 * 1000;
}

export function findResult(fixture: Match, results: RawResult[]): MatchResult | null {
  for (const r of results) {
    if (!withinADay(fixture.date, r.date)) continue;
    const o = orientation(fixture, r);
    if (!o) continue;
    // Scores oriented to team1 (home) / team2 (away).
    const homeScore = o === "direct" ? r.homeScore : r.awayScore;
    const awayScore = o === "direct" ? r.awayScore : r.homeScore;
    return {
      matchId: fixture.id,
      gradedAt: new Date().toISOString(),
      homeScore,
      awayScore,
      outcomeHit: null,
      exactHit: null,
    };
  }
  return null;
}

// Predicted winner: derive from the predicted score string "2-1".
function predictedOutcome(pred: Prediction): "home" | "draw" | "away" | null {
  const m = String(pred.score).match(/(\d+)\s*[-–:]\s*(\d+)/);
  if (!m) {
    // fall back to win_prob
    const { home, draw, away } = pred.winProb;
    const max = Math.max(home, draw, away);
    if (max === home) return "home";
    if (max === away) return "away";
    return "draw";
  }
  const h = parseInt(m[1], 10);
  const a = parseInt(m[2], 10);
  if (h > a) return "home";
  if (a > h) return "away";
  return "draw";
}

function actualOutcome(r: MatchResult): "home" | "draw" | "away" {
  if (r.homeScore > r.awayScore) return "home";
  if (r.awayScore > r.homeScore) return "away";
  return "draw";
}

export function applyGrade(result: MatchResult, pred?: Prediction): MatchResult {
  if (!pred) return result;
  const predOut = predictedOutcome(pred);
  const actOut = actualOutcome(result);
  const m = String(pred.score).match(/(\d+)\s*[-–:]\s*(\d+)/);
  const exactHit = m
    ? parseInt(m[1], 10) === result.homeScore && parseInt(m[2], 10) === result.awayScore
    : null;
  return { ...result, outcomeHit: predOut ? predOut === actOut : null, exactHit };
}
