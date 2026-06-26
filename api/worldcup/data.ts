import { methodNotAllowed, sendJson, serverError } from "../_lib/http.js";
import { redisGetJson, redisSetJson } from "../_lib/upstash.js";
import { fetchFixtures } from "./sources.js";
import { fetchLiveScores } from "./live.js";
import { getChampionOdds, getMatchValues } from "./odds.js";
import {
  getFixtures,
  getMeta,
  getPredictions,
  getResults,
  setFixtures,
} from "./store.js";
import type { ChampionOdd, KalshiData, KalshiMatchData, KalshiPrice, LiveScore, ValueAnalysis } from "./types.js";

// ---------------------------------------------------------------------------
// Kalshi read-only price fetcher (inlined to stay under Vercel Hobby 12-function limit).
// Series KXWCGAME — per-match YES/NO binary contracts, regulation time only.
// ---------------------------------------------------------------------------
const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_SERIES = "KXWCGAME";
const KALSHI_CACHE_KEY = "worldcup:kalshi:v1";
const KALSHI_TTL = 90_000; // 90 seconds
const KALSHI_TIMEOUT = 5_000;

const KALSHI_NORM_ALIASES: Record<string, string> = {
  turkiye: "turkey",
  congodr: "drcongo",
  irian: "iran",
  iranislamicrepublic: "iran",
};
function kalshiNorm(name: string): string {
  const base = String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  return KALSHI_NORM_ALIASES[base] ?? base;
}
function parseKalshiTeams(title: string): [string, string] | null {
  const m = title.match(/^(.+?)\s+vs\.?\s+(.+?)(?:\s+Winner\??)?$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}
function mkKalshiPrice(bid: number, ask: number): KalshiPrice {
  return { bid, ask, mid: Math.round(((bid + ask) / 2) * 1000) / 1000 };
}
function parseKalshiCents(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

async function fetchKalshiPrices(): Promise<KalshiMatchData[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KALSHI_TIMEOUT);
  try {
    const res = await fetch(
      `${KALSHI_BASE}/markets?series_ticker=${KALSHI_SERIES}&status=open&limit=200`,
      { headers: { Accept: "application/json" }, signal: controller.signal },
    );
    if (!res.ok) throw new Error(`Kalshi HTTP ${res.status}`);
    const data: any = await res.json();
    const markets: any[] = Array.isArray(data.markets) ? data.markets : [];

    const byEvent: Record<string, any[]> = {};
    for (const m of markets) {
      const et = String(m.event_ticker ?? "");
      if (et) (byEvent[et] = byEvent[et] ?? []).push(m);
    }

    const result: KalshiMatchData[] = [];
    for (const [eventTicker, eMarkets] of Object.entries(byEvent)) {
      if (eMarkets.length < 2) continue;
      const teams = parseKalshiTeams(String(eMarkets[0]?.title ?? ""));
      if (!teams) continue;
      const [team1, team2] = teams;
      const n1 = kalshiNorm(team1);
      const n2 = kalshiNorm(team2);

      let team1Win: KalshiPrice | null = null;
      let drawOutcome: KalshiPrice | null = null;
      let team2Win: KalshiPrice | null = null;

      for (const m of eMarkets) {
        const sub = String(m.yes_sub_title ?? m.subtitle ?? "").trim().replace(/^reg\s+time:\s*/i, "");
        const bid = parseKalshiCents(m.yes_bid_dollars ?? m.yes_bid);
        const ask = parseKalshiCents(m.yes_ask_dollars ?? m.yes_ask);
        if (bid === 0 && ask === 0) continue;
        if (/^tie$/i.test(sub)) drawOutcome = mkKalshiPrice(bid, ask);
        else if (kalshiNorm(sub) === n1) team1Win = mkKalshiPrice(bid, ask);
        else if (kalshiNorm(sub) === n2) team2Win = mkKalshiPrice(bid, ask);
      }
      if (!team1Win || !team2Win) continue;
      result.push({ eventTicker, team1, team2, team1Win, draw: drawOutcome, team2Win });
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function getKalshiData(): Promise<KalshiData> {
  const now = Date.now();
  const cached = await redisGetJson<{ ts: number; matches: KalshiMatchData[] }>(KALSHI_CACHE_KEY).catch(() => null);
  if (cached && now - cached.ts < KALSHI_TTL) {
    return { capturedAt: new Date(cached.ts).toISOString(), matches: cached.matches };
  }
  try {
    const matches = await fetchKalshiPrices();
    await redisSetJson(KALSHI_CACHE_KEY, { ts: now, matches }).catch(() => {});
    return { capturedAt: new Date(now).toISOString(), matches };
  } catch {
    if (cached) return { capturedAt: new Date(cached.ts).toISOString(), matches: cached.matches, stale: true };
    return { capturedAt: new Date(now).toISOString(), matches: [] };
  }
}

// ---------------------------------------------------------------------------
// Main data handler
// ---------------------------------------------------------------------------
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  try {
    let fixtures = await getFixtures();
    if (fixtures.length === 0) {
      try {
        fixtures = await fetchFixtures();
        await setFixtures(fixtures);
      } catch {
        /* source flaky */
      }
    }
    const ids = fixtures.map((m) => m.id);
    const [predictions, results, meta] = await Promise.all([
      getPredictions(ids),
      getResults(ids),
      getMeta(),
    ]);

    const now = Date.now();
    const LIVE_WINDOW_MS = 165 * 60 * 1000;
    const inPlay = fixtures.filter((f) => {
      if (results[f.id] || !f.kickoffUtc) return false;
      const k = new Date(f.kickoffUtc).getTime();
      return !Number.isNaN(k) && k <= now && now - k <= LIVE_WINDOW_MS;
    });
    let live: Record<string, LiveScore> = {};
    if (inPlay.length > 0) {
      try {
        live = await fetchLiveScores(inPlay);
      } catch {
        /* live feed optional */
      }
    }

    let value: Record<string, ValueAnalysis> = {};
    let champions: ChampionOdd[] = [];
    try {
      value = await getMatchValues(fixtures, predictions);
    } catch {
      /* odds optional */
    }
    try {
      champions = await getChampionOdds();
    } catch {
      /* champion odds optional */
    }

    // Kalshi prices — best-effort, never blocks the response.
    let kalshi: KalshiData = { capturedAt: new Date(now).toISOString(), matches: [] };
    try {
      kalshi = await getKalshiData();
    } catch {
      /* kalshi optional */
    }

    const hasLive = Object.keys(live).length > 0;
    res.setHeader("Cache-Control", `public, max-age=${hasLive ? 60 : 300}`);
    return sendJson(res, 200, { fixtures, predictions, results, live, value, champions, meta, kalshi });
  } catch (error) {
    return serverError(res, error);
  }
}
