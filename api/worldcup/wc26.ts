import { redisGetJson, redisSetJson } from "../_lib/upstash.js";

// Single throttled, Redis-cached fetch of the free worldcup26.ir feed. Its
// /get/games response carries EVERY match (not-started, live, finished) with
// scores, so one fetch serves both the live-score and the grading paths. We
// cache the parsed result in Redis for 10 minutes so that — no matter how many
// page loads or which endpoint asks — we hit the upstream feed at most ~6x/hour.
const WC26_URL = process.env.WORLDCUP_LIVE_URL || "https://worldcup26.ir/get/games";
const CACHE_KEY = "worldcup:wc26raw";
const THROTTLE_MS = 10 * 60 * 1000; // ≥10 min between upstream fetches
const FETCH_TIMEOUT_MS = 3500;

export interface Wc26Game {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  date: string; // YYYY-MM-DD (best-effort)
  status: "live" | "finished" | "notstarted";
  minute: string | null; // e.g. "67" when live and reported
}

interface RawWc26 {
  home_team_name_en?: string;
  away_team_name_en?: string;
  home_score?: string | number;
  away_score?: string | number;
  finished?: string; // "TRUE" | "FALSE"
  time_elapsed?: string; // "live" | "notstarted" | a minute like "67"
  local_date?: string; // "MM/DD/YYYY HH:mm"
}

function toNum(v: unknown): number | null {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isNaN(n) ? null : n;
}

function parseDate(s?: string): string {
  const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

function statusOf(g: RawWc26): Wc26Game["status"] {
  if (String(g.finished || "").toUpperCase() === "TRUE") return "finished";
  const t = String(g.time_elapsed || "").toLowerCase();
  if (t === "live" || /^\d+/.test(t)) return "live";
  return "notstarted";
}

function normalize(raw: RawWc26[]): Wc26Game[] {
  return raw
    .filter((g) => g.home_team_name_en && g.away_team_name_en)
    .map((g) => {
      const minute = String(g.time_elapsed || "");
      return {
        home: String(g.home_team_name_en),
        away: String(g.away_team_name_en),
        homeScore: toNum(g.home_score),
        awayScore: toNum(g.away_score),
        date: parseDate(g.local_date),
        status: statusOf(g),
        minute: /^\d+/.test(minute) ? minute.match(/^\d+/)![0] : null,
      };
    });
}

async function fetchDirect(): Promise<Wc26Game[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(WC26_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`wc26 fetch ${res.status}`);
    const data: any = await res.json();
    const raw: RawWc26[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.games)
          ? data.games
          : Array.isArray(data?.results)
            ? data.results
            : [];
    return normalize(raw);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cached games list. Serves the Redis copy when it's < 10 min old; otherwise
 * fetches once, re-caches, and returns. If the upstream feed is unreachable
 * (e.g. geo-blocked) it returns the last cached copy, or [] if none.
 */
export async function getWc26Games(): Promise<Wc26Game[]> {
  const cached = await redisGetJson<{ ts: number; games: Wc26Game[] }>(
    CACHE_KEY,
  ).catch(() => null);
  const now = Date.now();
  if (cached && now - cached.ts < THROTTLE_MS) return cached.games;
  try {
    const games = await fetchDirect();
    await redisSetJson(CACHE_KEY, { ts: now, games }).catch(() => {});
    return games;
  } catch {
    return cached?.games ?? [];
  }
}
