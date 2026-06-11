import { norm } from "./grade.js";
import { getWc26Games } from "./wc26.js";
import type { LiveScore, Match } from "./types.js";

// Live (in-progress) scores, DISPLAY-ONLY. Primary source is the free
// worldcup26.ir feed (via the throttled, Redis-cached getWc26Games). When a
// PAID API-Football plan is available (API_FOOTBALL_PAID=1 + API_FOOTBALL_KEY)
// it's tried first as the authoritative source. The free API-Football tier is
// NOT used here — it has no access to the 2026 season, so calling it would just
// waste the 100/day quota. Grading/results live in sources.ts.
const TIMEOUT_MS = 3500;
const API_FOOTBALL_URL =
  process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io/fixtures?live=all";

function apiFootballEnabled(): boolean {
  const paid = ["1", "true", "yes", "on"].includes(
    String(process.env.API_FOOTBALL_PAID || "").toLowerCase(),
  );
  return paid && !!(process.env.API_FOOTBALL_KEY || "").trim();
}

// Match two team names to one of our fixtures and store the score oriented to
// team1(home)/team2(away).
function store(
  out: Record<string, LiveScore>,
  fixtures: Match[],
  homeName: string,
  awayName: string,
  homeScore: number | null,
  awayScore: number | null,
  minute: string | null,
): void {
  if (homeScore == null || awayScore == null) return;
  const h = norm(homeName);
  const a = norm(awayName);
  const f = fixtures.find((x) => {
    const t1 = norm(x.team1);
    const t2 = norm(x.team2);
    return (t1 === h && t2 === a) || (t1 === a && t2 === h);
  });
  if (!f) return;
  const direct = norm(f.team1) === h;
  out[f.id] = {
    matchId: f.id,
    homeScore: direct ? homeScore : awayScore,
    awayScore: direct ? awayScore : homeScore,
    minute,
  };
}

// ---- worldcup26.ir (primary, free) ------------------------------------------
async function fromWorldcup26(
  fixtures: Match[],
): Promise<Record<string, LiveScore>> {
  const games = await getWc26Games();
  const out: Record<string, LiveScore> = {};
  for (const g of games) {
    if (g.status !== "live") continue;
    store(out, fixtures, g.home, g.away, g.homeScore, g.awayScore, g.minute);
  }
  return out;
}

// ---- API-Football (authoritative, paid only) --------------------------------
async function fromApiFootball(
  fixtures: Match[],
): Promise<Record<string, LiveScore>> {
  const key = (process.env.API_FOOTBALL_KEY || "").trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_FOOTBALL_URL, {
      headers: { "x-apisports-key": key },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API-Football live ${res.status}`);
    const data: any = await res.json();
    const games: any[] = Array.isArray(data?.response) ? data.response : [];
    const out: Record<string, LiveScore> = {};
    for (const g of games) {
      const elapsed = g?.fixture?.status?.elapsed;
      store(
        out,
        fixtures,
        String(g?.teams?.home?.name ?? ""),
        String(g?.teams?.away?.name ?? ""),
        g?.goals?.home ?? null,
        g?.goals?.away ?? null,
        elapsed != null ? String(elapsed) : null,
      );
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * In-progress scores keyed by fixture id. Paid API-Football first (if enabled
 * and it returns something), else the free worldcup26.ir feed. Never throws.
 */
export async function fetchLiveScores(
  fixtures: Match[],
): Promise<Record<string, LiveScore>> {
  if (apiFootballEnabled()) {
    try {
      const af = await fromApiFootball(fixtures);
      if (Object.keys(af).length > 0) return af;
    } catch {
      /* fall back to the free feed */
    }
  }
  try {
    return await fromWorldcup26(fixtures);
  } catch {
    return {};
  }
}
