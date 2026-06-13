// Frontend mirror of api/worldcup/types.ts. Kept independent so the two
// feature folders can be deleted without cross-references.

export type Stage = "group" | "knockout";

export interface Match {
  id: string;
  round: string;
  stage: Stage;
  group: string | null;
  date: string;
  timeRaw: string;
  kickoffUtc: string | null;
  team1: string;
  team2: string;
  ground: string;
}

export interface PredictionDetail {
  prediction?: {
    score?: string;
    win_prob?: { home?: number; draw?: number; away?: number };
    confidence?: string;
    over_under_2_5?: string;
    first_goal_window?: string;
  };
  factors?: {
    data?: { summary?: string; edge?: string };
    home_advantage?: {
      crowd?: string;
      travel?: string;
      climate_altitude?: string;
      referee?: string;
      net_goal_value?: string;
    };
    history?: { h2h?: string; patterns?: string };
    weather?: { conditions?: string; impact?: string };
    politics?: { summary?: string };
    tactics?: { matchup?: string; key_battle?: string };
    metaphysics?: { fun_fact?: string };
  };
  game_script?: string;
  biggest_risk?: string;
  key_players?: { name?: string; team?: string; why?: string }[];
  one_liner?: string;
}

export interface Prediction {
  matchId: string;
  generatedAt: string;
  model: string;
  score: string;
  winProb: { home: number; draw: number; away: number };
  confidence: "low" | "medium" | "medium-high" | "high";
  oneLiner: string;
  detail: PredictionDetail;
}

export interface MatchResult {
  matchId: string;
  gradedAt: string;
  homeScore: number;
  awayScore: number;
  outcomeHit: boolean | null;
  exactHit: boolean | null;
  marketOutcome?: "home" | "draw" | "away" | null;
  marketHit?: boolean | null;
}

// In-progress score from the optional live feed. Display-only.
export interface LiveScore {
  matchId: string;
  homeScore: number;
  awayScore: number;
  minute: string | null;
}

// "Model vs market" value analysis. Descriptive only — not betting advice.
export type ValueVerdict = "gap_high" | "gap" | "fair" | "market_high";

export interface ValueOutcome {
  label: "team1" | "draw" | "team2";
  modelProb: number;
  impliedProb: number;
  edgeRatio: number;
  verdict: ValueVerdict;
}

export interface ValueAnalysis {
  matchId: string;
  capturedAt: string;
  books: number;
  outcomes: ValueOutcome[];
  topVerdict: ValueVerdict;
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
    marketGraded: number;
    marketHits: number;
  };
}

export interface WorldCupData {
  fixtures: Match[];
  predictions: Record<string, Prediction>;
  results: Record<string, MatchResult>;
  live?: Record<string, LiveScore>;
  value?: Record<string, ValueAnalysis>;
  meta: WorldCupMeta | null;
}
