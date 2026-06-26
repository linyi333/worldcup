// Shared types for the World Cup feature (backend). The frontend keeps its own
// mirror in src/features/worldcup/types.ts so the two folders stay independent.

export type Stage = "group" | "knockout";

export interface Match {
  id: string;
  round: string;
  stage: Stage;
  group: string | null;
  date: string; // YYYY-MM-DD as published by the source
  timeRaw: string; // e.g. "13:00 UTC-6"
  kickoffUtc: string | null; // ISO 8601, or null if unparseable
  team1: string;
  team2: string;
  ground: string;
}

// Prediction (Phase 2) and Result (Phase 3) shapes are declared here so the
// /data endpoint response stays stable as those phases land.
export interface Prediction {
  matchId: string;
  generatedAt: string;
  model: string;
  score: string;
  winProb: { home: number; draw: number; away: number };
  confidence: "low" | "medium" | "medium-high" | "high";
  oneLiner: string;
  // The full 8-factor payload is stored verbatim under `detail`.
  detail: Record<string, unknown>;
  // Knockout cache-invalidation key: "team1|team2|resultsForTeam1|resultsForTeam2".
  // Recomputed on every refresh; mismatch triggers regeneration with fresh context.
  contextKey?: string;
  // Market-implied probs (decimal 0–1) at the time this prediction was generated.
  // Used later to compute CLV: did the model beat the closing line?
  marketProbsAtPrediction?: { home: number; draw: number; away: number };
}

export interface MatchResult {
  matchId: string;
  gradedAt: string;
  homeScore: number;
  awayScore: number;
  outcomeHit: boolean | null; // predicted winner correct?
  exactHit: boolean | null; // exact scoreline correct?
  marketOutcome?: "home" | "draw" | "away" | null; // market's pick (odds favorite)
  marketHit?: boolean | null; // market's pick correct? (null if no closing odds)
  // CLV (closing line value): model_prob − close_prob for the predicted outcome,
  // in percentage points. Positive = model was more confident than the market closed.
  // Null when no closing odds were available for this match.
  clv?: number | null;
}

// In-progress score from the optional live feed. Best-effort, display-only —
// never used for grading (that stays on the authoritative results source).
export interface LiveScore {
  matchId: string;
  homeScore: number;
  awayScore: number;
  minute: string | null; // e.g. "67" if the feed reports it, else null
}

// "Model vs market" value analysis. Descriptive only — compares the model's
// win probability to the de-vigged market-implied probability. NOT betting
// advice and never a stake suggestion.
export type ValueVerdict = "gap_high" | "gap" | "fair" | "market_high";

export interface ValueOutcome {
  label: "team1" | "draw" | "team2";
  modelProb: number; // model win probability, %
  impliedProb: number; // de-vigged market-implied probability, %
  edgeRatio: number; // modelProb / impliedProb
  verdict: ValueVerdict;
}

// Asian handicap (让球), as de-vigged implied probabilities. Display-only.
export interface ValueHandicap {
  line: number; // home team's handicap point, e.g. +1.5 (away is the negative)
  homeProb: number; // implied % the home side covers
  awayProb: number; // implied % the away side covers
  modelHome: boolean | null; // does the model's predicted score have home covering?
}

// Over/Under (大小球), as de-vigged implied probabilities. Display-only.
export interface ValueTotals {
  line: number; // e.g. 2.5
  overProb: number;
  underProb: number;
  modelOver: boolean | null; // does the model lean over?
}

export interface ValueAnalysis {
  matchId: string;
  capturedAt: string; // when the odds snapshot was taken
  books: number; // bookmakers aggregated
  outcomes: ValueOutcome[];
  topVerdict: ValueVerdict;
  handicap?: ValueHandicap;
  totals?: ValueTotals;
}

// Market-implied title (champion) probability per team. Entertainment only.
export interface ChampionOdd {
  team: string;
  prob: number; // de-vigged implied probability, %
}

// Kalshi per-contract price (YES bid / ask / mid), dollars 0-1.
export interface KalshiPrice {
  bid: number;
  ask: number;
  mid: number;
}

// Per-match Kalshi prices for home win / draw / away win contracts.
export interface KalshiMatchData {
  eventTicker: string;
  team1: string; // first team in Kalshi event title
  team2: string;
  team1Win: KalshiPrice;
  draw: KalshiPrice | null;
  team2Win: KalshiPrice;
}

export interface KalshiData {
  capturedAt: string;
  matches: KalshiMatchData[];
  stale?: boolean;
}

export interface WorldCupMeta {
  lastSyncAt: string | null;
  fixturesCount: number;
  predictionsCount: number;
  resultsCount: number;
  accuracy: {
    graded: number;
    outcomeHits: number;
    exactHits: number;
    marketGraded: number; // matches graded that also had closing odds
    marketHits: number; // of those, market's pick was correct
    clvGraded: number; // matches with both a prediction and closing odds (CLV computed)
    avgClv: number; // average CLV across those matches, in percentage points
    clvPositive: number; // count of matches where model had positive CLV
  };
}
