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
    .replace(/&/g, "and") // "Bosnia & Herzegovina" == "Bosnia and Herzegovina"
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
    const result: MatchResult = {
      matchId: fixture.id,
      gradedAt: new Date().toISOString(),
      homeScore,
      awayScore,
      outcomeHit: null,
      exactHit: null,
    };
    // Pass through ET and penalty scores, respecting orientation swap
    if (r.etHomeScore != null && r.etAwayScore != null) {
      result.etHomeScore = o === "direct" ? r.etHomeScore : r.etAwayScore;
      result.etAwayScore = o === "direct" ? r.etAwayScore : r.etHomeScore;
    }
    if (r.penHomeScore != null && r.penAwayScore != null) {
      result.penHomeScore = o === "direct" ? r.penHomeScore : r.penAwayScore;
      result.penAwayScore = o === "direct" ? r.penAwayScore : r.penHomeScore;
    }
    // Knockout winner: penalties → extra time → regulation (in priority order)
    if (result.penHomeScore != null && result.penAwayScore != null) {
      result.knockoutWinner = result.penHomeScore > result.penAwayScore ? "home" : "away";
    } else if (result.etHomeScore != null && result.etAwayScore != null && result.etHomeScore !== result.etAwayScore) {
      result.knockoutWinner = result.etHomeScore > result.etAwayScore ? "home" : "away";
    } else if (result.homeScore !== result.awayScore) {
      result.knockoutWinner = result.homeScore > result.awayScore ? "home" : "away";
    } else {
      result.knockoutWinner = null; // group stage draw or data not yet available
    }
    return result;
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

// Market's pick = the outcome with the highest implied probability (odds favorite).
function marketOutcomeOf(p: {
  home: number;
  draw: number;
  away: number;
}): "home" | "draw" | "away" {
  if (p.home >= p.draw && p.home >= p.away) return "home";
  if (p.away >= p.draw && p.away >= p.home) return "away";
  return "draw";
}

export function applyGrade(
  result: MatchResult,
  pred?: Prediction,
  marketProbs?: { home: number; draw: number; away: number },
): MatchResult {
  // Accuracy is always based on 90-minute regulation outcome (home win / draw / away win).
  // ET and penalty results are displayed separately as "fun" advancement guesses and are
  // NOT factored into outcomeHit or marketHit — the model predicts regulation time only.
  const actOut = actualOutcome(result);

  let outcomeHit: boolean | null = null;
  let exactHit: boolean | null = null;
  if (pred) {
    const predOut = predictedOutcome(pred);
    const m = String(pred.score).match(/(\d+)\s*[-–:]\s*(\d+)/);
    exactHit = m
      ? parseInt(m[1], 10) === result.homeScore && parseInt(m[2], 10) === result.awayScore
      : null;
    outcomeHit = predOut ? predOut === actOut : null;
  }

  let marketOutcome: "home" | "draw" | "away" | null = null;
  let marketHit: boolean | null = null;
  if (marketProbs) {
    marketOutcome = marketOutcomeOf(marketProbs);
    marketHit = marketOutcome === actOut;
  }

  // CLV: model_prob − market_prob for the predicted outcome, in percentage points.
  // Uses the market snapshot captured at prediction time, not the current odds.
  let clv: number | null = null;
  if (pred && pred.marketProbsAtPrediction) {
    const predOut = predictedOutcome(pred);
    if (predOut) {
      const modelFrac = pred.winProb[predOut] / 100;
      const mktFrac = pred.marketProbsAtPrediction[predOut];
      clv = Math.round((modelFrac - mktFrac) * 1000) / 10; // pp, 1 dp
    }
  }

  return { ...result, outcomeHit, exactHit, marketOutcome, marketHit, clv };
}
