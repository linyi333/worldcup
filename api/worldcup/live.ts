import { norm } from "./grade.js";
import type { LiveScore, Match } from "./types.js";

// Optional, DISPLAY-ONLY live scores. Two providers, tried in order:
//   1. API-Football (authoritative; needs a free key in API_FOOTBALL_KEY)
//   2. worldcup26.ir (free, no key; community feed, may be geo-blocked)
// Both are best-effort: any error/timeout → fall through, and a total failure
// resolves to {} so the app simply shows its normal pre-match / finished states.
// Grading/results always stay on TheSportsDB (sources.ts/grade.ts).
const TIMEOUT_MS = 3500;
const WC26_URL = process.env.WORLDCUP_LIVE_URL || "https://worldcup26.ir/get/games";
const API_FOOTBALL_URL =
  process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io/fixtures?live=all";

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`live fetch ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Match a live game's two team names to one of our fixtures and store the score
// oriented to team1(home)/team2(away).
function store(
  out: Record<string, LiveScore>,
  fixtures: Match[],
  homeName: string,
  awayName: string,
  homeScore: number,
  awayScore: number,
  minute: string | null,
): void {
  const h = norm(homeName);
  const a = norm(awayName);
  const f = fixtures.find((x) => {
    const t1 = norm(x.team1);
    const t2 = norm(x.team2);
    return (t1 === h && t2 === a) || (t1 === a && t2 === h);
  });
  if (!f) return;
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return;
  const direct = norm(f.team1) === h;
  out[f.id] = {
    matchId: f.id,
    homeScore: direct ? homeScore : awayScore,
    awayScore: direct ? awayScore : homeScore,
    minute,
  };
}

// ---- Provider 1: API-Football -----------------------------------------------
// Returns null when no key is configured (signals "try the fallback"). When the
// key IS set and the request succeeds, returns the map even if empty — an empty
// authoritative result means "nothing is live", so we don't hit the fallback.
async function fromApiFootball(
  fixtures: Match[],
): Promise<Record<string, LiveScore> | null> {
  const key = (process.env.API_FOOTBALL_KEY || "").trim();
  if (!key) return null;
  const data = await fetchJson(API_FOOTBALL_URL, {
    headers: { "x-apisports-key": key },
  });
  const games: any[] = Array.isArray(data?.response) ? data.response : [];
  const out: Record<string, LiveScore> = {};
  for (const g of games) {
    const elapsed = g?.fixture?.status?.elapsed;
    store(
      out,
      fixtures,
      String(g?.teams?.home?.name ?? ""),
      String(g?.teams?.away?.name ?? ""),
      Number(g?.goals?.home),
      Number(g?.goals?.away),
      elapsed != null ? String(elapsed) : null,
    );
  }
  return out;
}

// ---- Provider 2: worldcup26.ir ----------------------------------------------
interface RawWc26 {
  home_team_name_en?: string;
  away_team_name_en?: string;
  home_score?: string | number;
  away_score?: string | number;
  finished?: string; // "TRUE" | "FALSE"
  time_elapsed?: string; // "live" | "notstarted" | a minute like "67"
}

function wc26IsLive(g: RawWc26): boolean {
  if (String(g.finished || "").toUpperCase() === "TRUE") return false;
  const status = String(g.time_elapsed || "").toLowerCase();
  return status === "live" || /^\d+/.test(status);
}

async function fromWorldcup26(
  fixtures: Match[],
): Promise<Record<string, LiveScore>> {
  const data = await fetchJson(WC26_URL);
  const raw: RawWc26[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.games)
        ? data.games
        : Array.isArray(data?.results)
          ? data.results
          : [];
  const out: Record<string, LiveScore> = {};
  for (const g of raw.filter(wc26IsLive)) {
    const minute = String(g.time_elapsed || "");
    store(
      out,
      fixtures,
      String(g.home_team_name_en ?? ""),
      String(g.away_team_name_en ?? ""),
      parseInt(String(g.home_score ?? ""), 10),
      parseInt(String(g.away_score ?? ""), 10),
      /^\d+/.test(minute) ? minute.match(/^\d+/)![0] : null,
    );
  }
  return out;
}

/**
 * In-progress scores keyed by fixture id, oriented to team1(home)/team2(away).
 * Tries API-Football (if keyed) then worldcup26.ir. Never throws.
 */
export async function fetchLiveScores(
  fixtures: Match[],
): Promise<Record<string, LiveScore>> {
  try {
    const primary = await fromApiFootball(fixtures);
    if (primary) return primary; // keyed + request ok (empty = nothing live)
  } catch {
    /* primary failed — fall back */
  }
  try {
    return await fromWorldcup26(fixtures);
  } catch {
    return {};
  }
}
