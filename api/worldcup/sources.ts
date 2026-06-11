import type { Match, Stage } from "./types.js";

// Free, public-domain fixtures. No API key. Override via env if the path moves.
const FIXTURES_URL =
  process.env.WORLDCUP_FIXTURES_URL ||
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

interface RawMatch {
  round?: string;
  num?: number;
  date?: string;
  time?: string;
  team1?: string;
  team2?: string;
  group?: string;
  ground?: string;
}

function slug(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// "13:00 UTC-6" -> ISO UTC string, or null if it can't be parsed.
function toKickoffUtc(date?: string, time?: string): string | null {
  if (!date || !time) return null;
  const m = time.match(/(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})/i);
  if (!m) return null;
  const [, hh, mm, off] = m;
  const sign = off.startsWith("-") ? "-" : "+";
  const offHours = String(Math.abs(parseInt(off, 10))).padStart(2, "0");
  const iso = `${date}T${hh.padStart(2, "0")}:${mm}:00${sign}${offHours}:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function makeMatchId(raw: RawMatch): string {
  if (raw.num != null) return `wc26-m${raw.num}`;
  return `wc26-${raw.date}-${slug(raw.team1 || "t1")}-${slug(raw.team2 || "t2")}`;
}

// FIFA World Cup league id on TheSportsDB. Free tier key "3" (override via env).
const THESPORTSDB_KEY = process.env.THESPORTSDB_KEY || "3";
const WC_LEAGUE_ID = process.env.WORLDCUP_LEAGUE_ID || "4429";

export interface RawResult {
  date: string; // YYYY-MM-DD
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

// Finished matches for grading. Primary source is API-Football (authoritative,
// carries 2026 data) when API_FOOTBALL_KEY is set; otherwise / on failure we
// fall back to TheSportsDB. Both return the same RawResult shape; grade.ts
// reconciles team names.
const API_FOOTBALL_RESULTS_URL =
  process.env.API_FOOTBALL_RESULTS_URL ||
  "https://v3.football.api-sports.io/fixtures?league=1&season=2026";
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Returns null when no key is configured (signals "use the fallback").
async function fetchResultsApiFootball(): Promise<RawResult[] | null> {
  const key = (process.env.API_FOOTBALL_KEY || "").trim();
  if (!key) return null;
  const res = await fetchWithTimeout(API_FOOTBALL_RESULTS_URL, {
    headers: { "x-apisports-key": key },
  });
  if (!res.ok) throw new Error(`API-Football results ${res.status}`);
  const data = (await res.json()) as { response?: any[] };
  const games = Array.isArray(data?.response) ? data.response : [];
  return games
    .filter(
      (g) =>
        FINISHED_STATUSES.has(g?.fixture?.status?.short) &&
        g?.goals?.home != null &&
        g?.goals?.away != null,
    )
    .map((g): RawResult => ({
      date: String(g?.fixture?.date || "").slice(0, 10),
      home: String(g?.teams?.home?.name || ""),
      away: String(g?.teams?.away?.name || ""),
      homeScore: Number(g.goals.home),
      awayScore: Number(g.goals.away),
    }));
}

async function fetchResultsTheSportsDB(): Promise<RawResult[]> {
  const url = `https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}/eventspastleague.php?id=${WC_LEAGUE_ID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Results fetch failed: ${res.status}`);
  const data = (await res.json()) as { events?: any[] };
  const events = Array.isArray(data?.events) ? data.events : [];

  return events
    .filter(
      (e) =>
        e.strHomeTeam &&
        e.strAwayTeam &&
        e.intHomeScore != null &&
        e.intAwayScore != null,
    )
    .map((e): RawResult => ({
      date: String(e.dateEvent || ""),
      home: String(e.strHomeTeam),
      away: String(e.strAwayTeam),
      homeScore: parseInt(e.intHomeScore, 10),
      awayScore: parseInt(e.intAwayScore, 10),
    }));
}

export async function fetchResults(): Promise<RawResult[]> {
  try {
    const af = await fetchResultsApiFootball();
    if (af) return af; // keyed + request ok
  } catch {
    /* primary failed — fall back to TheSportsDB */
  }
  return fetchResultsTheSportsDB();
}

export async function fetchFixtures(): Promise<Match[]> {
  const res = await fetch(FIXTURES_URL);
  if (!res.ok) {
    throw new Error(`Fixtures fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { matches?: RawMatch[] };
  const matches = Array.isArray(data?.matches) ? data.matches : [];

  return matches
    .filter((m) => m.team1 && m.team2 && m.date)
    .map((m): Match => {
      const stage: Stage = m.group ? "group" : "knockout";
      return {
        id: makeMatchId(m),
        round: m.round || "",
        stage,
        group: m.group || null,
        date: m.date as string,
        timeRaw: m.time || "",
        kickoffUtc: toKickoffUtc(m.date, m.time),
        team1: m.team1 as string,
        team2: m.team2 as string,
        ground: m.ground || "",
      };
    });
}
