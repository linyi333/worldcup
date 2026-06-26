// Kalshi read-only price endpoint for World Cup soccer matches.
// Series: KXWCGAME — per-match YES/NO binary contracts.
// No API key required. Prices cached 90s in Redis.
import { methodNotAllowed, sendJson, serverError } from "../_lib/http.js";
import { redisGetJson, redisSetJson } from "../_lib/upstash.js";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const SERIES = "KXWCGAME";
const CACHE_KEY = "worldcup:kalshi:v1";
const CACHE_TTL = 90_000; // 90 seconds
const TIMEOUT_MS = 5_000;

export interface KalshiPrice {
  bid: number; // YES bid, dollars 0-1
  ask: number; // YES ask, dollars 0-1
  mid: number; // (bid+ask)/2
}

export interface KalshiMatchData {
  eventTicker: string;
  team1: string; // first team in Kalshi title
  team2: string; // second team in Kalshi title
  team1Win: KalshiPrice;
  draw: KalshiPrice | null;
  team2Win: KalshiPrice;
}

export interface KalshiResponse {
  capturedAt: string;
  matches: KalshiMatchData[];
  stale?: boolean;
}

interface KalshiCache {
  ts: number;
  matches: KalshiMatchData[];
}

function parsePrice(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function mkPrice(bid: number, ask: number): KalshiPrice {
  return { bid, ask, mid: Math.round(((bid + ask) / 2) * 1000) / 1000 };
}

// Normalize team name for matching YES subtitle to team1/team2.
// Mirrors grade.ts norm() with Kalshi-specific additions.
const KALSHI_ALIASES: Record<string, string> = {
  turkiye: "turkey",
  congodr: "drcongo",
  irian: "iran", // "IR Iran" → strip non-alpha → "irian"
  iranislamicrepublic: "iran",
};
function normTeam(name: string): string {
  const base = String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return KALSHI_ALIASES[base] ?? base;
}

// "Turkiye vs USA Winner?" → ["Turkiye", "USA"]
// "Paraguay vs Australia Winner?" → ["Paraguay", "Australia"]
function parseTeams(title: string): [string, string] | null {
  const m = title.match(/^(.+?)\s+vs\.?\s+(.+?)(?:\s+Winner\??)?$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

async function fetchFromKalshi(): Promise<KalshiMatchData[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${KALSHI_BASE}/markets?series_ticker=${SERIES}&status=open&limit=200`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Kalshi HTTP ${res.status}`);
    const data: any = await res.json();
    const markets: any[] = Array.isArray(data.markets) ? data.markets : [];

    // Group markets by event_ticker
    const byEvent: Record<string, any[]> = {};
    for (const m of markets) {
      const et = String(m.event_ticker ?? "");
      if (et) (byEvent[et] = byEvent[et] ?? []).push(m);
    }

    const result: KalshiMatchData[] = [];
    for (const [eventTicker, eMarkets] of Object.entries(byEvent)) {
      if (eMarkets.length < 2) continue;

      // Parse team names from the common title
      const title = String(eMarkets[0]?.title ?? "");
      const teams = parseTeams(title);
      if (!teams) continue;
      const [team1, team2] = teams;
      const normT1 = normTeam(team1);
      const normT2 = normTeam(team2);

      let team1Win: KalshiPrice | null = null;
      let drawOutcome: KalshiPrice | null = null;
      let team2Win: KalshiPrice | null = null;

      for (const m of eMarkets) {
        // yes_sub_title is the most reliable outcome label
        const sub = String(m.yes_sub_title ?? m.subtitle ?? "").trim();
        // Knock-out matches prefix with "Reg Time: " — strip it
        const clean = sub.replace(/^reg\s+time:\s*/i, "");

        const bid = parsePrice(m.yes_bid_dollars ?? m.yes_bid);
        const ask = parsePrice(m.yes_ask_dollars ?? m.yes_ask);
        if (bid === 0 && ask === 0) continue; // skip unlaunched markets

        if (/^tie$/i.test(clean)) {
          drawOutcome = mkPrice(bid, ask);
        } else if (normTeam(clean) === normT1) {
          team1Win = mkPrice(bid, ask);
        } else if (normTeam(clean) === normT2) {
          team2Win = mkPrice(bid, ask);
        }
      }

      if (!team1Win || !team2Win) continue; // couldn't identify both outcomes

      result.push({ eventTicker, team1, team2, team1Win, draw: drawOutcome, team2Win });
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const now = Date.now();
    const cached = await redisGetJson<KalshiCache>(CACHE_KEY).catch(() => null);

    if (cached && now - cached.ts < CACHE_TTL) {
      res.setHeader("Cache-Control", "public, max-age=60");
      return sendJson(res, 200, {
        capturedAt: new Date(cached.ts).toISOString(),
        matches: cached.matches,
      } satisfies KalshiResponse);
    }

    const matches = await fetchFromKalshi();
    await redisSetJson(CACHE_KEY, { ts: now, matches } satisfies KalshiCache).catch(() => {});
    res.setHeader("Cache-Control", "public, max-age=60");
    return sendJson(res, 200, {
      capturedAt: new Date(now).toISOString(),
      matches,
    } satisfies KalshiResponse);
  } catch (error) {
    // Serve stale on upstream failure rather than a hard error
    const cached = await redisGetJson<KalshiCache>(CACHE_KEY).catch(() => null);
    if (cached) {
      return sendJson(res, 200, {
        capturedAt: new Date(cached.ts).toISOString(),
        matches: cached.matches,
        stale: true,
      } satisfies KalshiResponse);
    }
    return serverError(res, error);
  }
}
