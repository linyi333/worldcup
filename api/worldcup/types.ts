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
}

export interface MatchResult {
  matchId: string;
  gradedAt: string;
  homeScore: number;
  awayScore: number;
  outcomeHit: boolean | null; // predicted winner correct?
  exactHit: boolean | null; // exact scoreline correct?
}

// In-progress score from the optional live feed. Best-effort, display-only —
// never used for grading (that stays on the authoritative results source).
export interface LiveScore {
  matchId: string;
  homeScore: number;
  awayScore: number;
  minute: string | null; // e.g. "67" if the feed reports it, else null
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
  };
}
