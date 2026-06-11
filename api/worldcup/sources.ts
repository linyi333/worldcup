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

// Recent finished matches (TheSportsDB free tier returns the last ~15 events,
// which comfortably covers one day of a World Cup for incremental daily grading).
export async function fetchResults(): Promise<RawResult[]> {
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
