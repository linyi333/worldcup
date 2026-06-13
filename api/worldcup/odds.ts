import { norm } from "./grade.js";
import { redisGetJson, redisSetJson } from "../_lib/upstash.js";
import type {
  ChampionOdd,
  Match,
  ValueAnalysis,
  ValueHandicap,
  ValueOutcome,
  ValueTotals,
  ValueVerdict,
} from "./types.js";

// "Model vs market" value analysis — DISPLAY/ANALYSIS ONLY, not betting advice.
// We pull pre-match 1X2 (h2h) odds from The Odds API (free tier), de-vig them
// into implied probabilities, and compare against the model's win_prob. The
// output is a descriptive scale of where the model and the market disagree —
// never a recommendation to wager and never a stake size.
//
// Odds drift until kickoff, so we refresh on a throttle and the comparison
// reflects the latest pre-match price; once a match starts we stop refreshing.
const ODDS_URL =
  process.env.ODDS_API_URL ||
  "https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/";
const ODDS_REGION = process.env.ODDS_API_REGION || "eu";
const CACHE_KEY = "worldcup:odds";
const COUNT_KEY = "worldcup:odds:month"; // monthly credit counter (hard cap)
const CLOSE_KEY = "worldcup:close"; // last pre-match implied probs per match (closing line)
const CHAMP_URL =
  process.env.ODDS_CHAMP_URL ||
  "https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup_winner/odds/";
const CHAMP_KEY = "worldcup:champions";
// Title odds barely move day-to-day, so refresh slowly (counts 1 credit/fetch).
const CHAMP_THROTTLE_MS = Number(process.env.ODDS_CHAMP_THROTTLE_MS || 24 * 60 * 60 * 1000);
const THROTTLE_MS = Number(process.env.ODDS_THROTTLE_MS || 6 * 60 * 60 * 1000);
// Only refresh odds when a match kicks off within this window (so credits are
// spent only when odds are actually relevant — not on off-days/far-out matches).
const FETCH_WINDOW_MS = Number(process.env.ODDS_FETCH_WINDOW_MS || 36 * 60 * 60 * 1000);
// Hard ceiling on upstream calls per calendar month. The free tier is 500; we
// cap below it and serve the last cached odds once reached. 1 credit/call.
const MONTHLY_CAP = Number(process.env.ODDS_API_MONTHLY_CAP || "450");
const TIMEOUT_MS = 4000;

// Normalize a team name for matching: treat "&" as "and", then reuse the
// project's normalizer (handles diacritics + the USA/Korea/etc. alias map).
function teamKey(s: string): string {
  return norm(String(s).replace(/&/g, " and "));
}

interface OddsCache {
  ts: number;
  events: any[];
}

// Monthly credit counter so we can never blow past the free-tier limit.
function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7); // YYYY-MM (UTC)
}
async function underMonthlyCap(now: number): Promise<boolean> {
  const rec = await redisGetJson<{ month: string; count: number }>(COUNT_KEY).catch(
    () => null,
  );
  if (!rec || rec.month !== monthKey(now)) return true; // fresh month
  return rec.count < MONTHLY_CAP;
}
// credits = actual credits the API deducted (markets × regions). The Odds API
// reports it in the x-requests-last header; we pass it through so the cap
// tracks real spend (a 3-market call costs 3, not 1).
async function bumpMonthly(now: number, credits = 1): Promise<void> {
  const rec = await redisGetJson<{ month: string; count: number }>(COUNT_KEY).catch(
    () => null,
  );
  const m = monthKey(now);
  const count = (rec && rec.month === m ? rec.count : 0) + Math.max(1, credits);
  await redisSetJson(COUNT_KEY, { month: m, count }).catch(() => {});
}

function creditsUsed(res: Response, fallback: number): number {
  const n = Number(res.headers.get("x-requests-last"));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// `mayFetch` gates a NEW upstream call (set when a match is upcoming soon). The
// cache is always served when present; we only spend a credit when the cache is
// stale AND a match is near AND we're under the monthly cap.
async function getRawEvents(mayFetch: boolean): Promise<OddsCache | null> {
  const key = (process.env.ODDS_API_KEY || "").trim();
  if (!key) return null;
  const cached = await redisGetJson<OddsCache>(CACHE_KEY).catch(() => null);
  const now = Date.now();
  if (cached && now - cached.ts < THROTTLE_MS) return cached; // fresh enough
  if (!mayFetch) return cached; // no match near → don't spend a credit
  if (!(await underMonthlyCap(now))) return cached; // hard cap → serve stale

  const url = `${ODDS_URL}?apiKey=${encodeURIComponent(key)}&regions=${ODDS_REGION}&markets=h2h,spreads,totals&oddsFormat=decimal`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`odds ${res.status}`);
    const events = await res.json();
    const fresh: OddsCache = { ts: now, events: Array.isArray(events) ? events : [] };
    await redisSetJson(CACHE_KEY, fresh).catch(() => {});
    await bumpMonthly(now, creditsUsed(res, 3)); // h2h + spreads + totals = 3
    return fresh;
  } catch {
    return cached ?? null; // serve stale on failure
  } finally {
    clearTimeout(timer);
  }
}

function findEvent(events: any[], f: Match): any | null {
  const t1 = teamKey(f.team1);
  const t2 = teamKey(f.team2);
  return (
    events.find((e) => {
      const h = teamKey(e?.home_team ?? "");
      const a = teamKey(e?.away_team ?? "");
      return (h === t1 && a === t2) || (h === t2 && a === t1);
    }) ?? null
  );
}

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n) && n > 1).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// De-vigged implied probabilities (0-1) for team1 / draw / team2, aggregated as
// the median decimal price across all bookmakers, then normalized to sum to 1.
function devigH2H(
  event: any,
  f: Match,
): { team1: number; draw: number; team2: number; books: number } | null {
  const t1 = teamKey(f.team1);
  const t2 = teamKey(f.team2);
  const p1: number[] = [];
  const pd: number[] = [];
  const p2: number[] = [];
  const books = Array.isArray(event?.bookmakers) ? event.bookmakers : [];
  for (const bk of books) {
    const m = (bk?.markets ?? []).find((x: any) => x?.key === "h2h");
    if (!m) continue;
    for (const o of m.outcomes ?? []) {
      const name = String(o?.name ?? "");
      const price = Number(o?.price);
      if (/^draw$/i.test(name)) pd.push(price);
      else if (teamKey(name) === t1) p1.push(price);
      else if (teamKey(name) === t2) p2.push(price);
    }
  }
  const m1 = median(p1);
  const md = median(pd);
  const m2 = median(p2);
  if (m1 == null || md == null || m2 == null) return null;
  const r1 = 1 / m1;
  const rd = 1 / md;
  const r2 = 1 / m2;
  const sum = r1 + rd + r2; // > 1 by the vig; normalize it away
  return {
    team1: r1 / sum,
    draw: rd / sum,
    team2: r2 / sum,
    books: Math.max(p1.length, pd.length, p2.length),
  };
}

function mode(nums: number[]): number | null {
  if (!nums.length) return null;
  const c = new Map<number, number>();
  for (const n of nums) c.set(n, (c.get(n) || 0) + 1);
  let best = nums[0];
  let bestC = 0;
  for (const [k, v] of c) if (v > bestC) ((best = k), (bestC = v));
  return best;
}

// Over/Under (大小球): pick the main line (2.5 if present, else most-quoted),
// median over/under prices at that line, de-vig the two-way market.
function devigTotals(event: any): { line: number; over: number; under: number } | null {
  const byLine: Record<number, { over: number[]; under: number[] }> = {};
  for (const bk of event?.bookmakers ?? []) {
    const m = (bk?.markets ?? []).find((x: any) => x?.key === "totals");
    if (!m) continue;
    for (const o of m.outcomes ?? []) {
      const pt = Number(o?.point);
      const pr = Number(o?.price);
      if (!Number.isFinite(pt) || !(pr > 1)) continue;
      const slot = (byLine[pt] = byLine[pt] || { over: [], under: [] });
      if (/over/i.test(o?.name)) slot.over.push(pr);
      else if (/under/i.test(o?.name)) slot.under.push(pr);
    }
  }
  const lines = Object.keys(byLine).map(Number);
  if (!lines.length) return null;
  const line = byLine[2.5]
    ? 2.5
    : lines.sort(
        (a, b) =>
          byLine[b].over.length + byLine[b].under.length -
          (byLine[a].over.length + byLine[a].under.length),
      )[0];
  const o = median(byLine[line].over);
  const u = median(byLine[line].under);
  if (o == null || u == null) return null;
  const ro = 1 / o;
  const ru = 1 / u;
  const s = ro + ru;
  return { line, over: ro / s, under: ru / s };
}

// Asian handicap (让球): outcomes are named by team. Pick the modal home line,
// median prices at that line, de-vig the two-way market.
function devigHandicap(
  event: any,
  f: Match,
): { line: number; home: number; away: number } | null {
  const t1 = teamKey(f.team1);
  const t2 = teamKey(f.team2);
  const entries: { homePt: number; homePrice: number; awayPrice: number }[] = [];
  for (const bk of event?.bookmakers ?? []) {
    const m = (bk?.markets ?? []).find((x: any) => x?.key === "spreads");
    if (!m) continue;
    let homePt: number | null = null;
    let homePrice: number | null = null;
    let awayPrice: number | null = null;
    for (const o of m.outcomes ?? []) {
      const k = teamKey(o?.name ?? "");
      const pr = Number(o?.price);
      const pt = Number(o?.point);
      if (k === t1) {
        homePt = pt;
        homePrice = pr;
      } else if (k === t2) {
        awayPrice = pr;
      }
    }
    if (homePt != null && homePrice && homePrice > 1 && awayPrice && awayPrice > 1) {
      entries.push({ homePt, homePrice, awayPrice });
    }
  }
  if (!entries.length) return null;
  const line = mode(entries.map((e) => e.homePt)) as number;
  const at = entries.filter((e) => e.homePt === line);
  const hp = median(at.map((e) => e.homePrice));
  const ap = median(at.map((e) => e.awayPrice));
  if (hp == null || ap == null) return null;
  const rh = 1 / hp;
  const ra = 1 / ap;
  const s = rh + ra;
  return { line, home: rh / s, away: ra / s };
}

// Parse a predicted scoreline "2-1" → [home, away] goals, or null.
function parseScore(score?: string): [number, number] | null {
  const m = String(score ?? "").match(/(\d+)\s*[-–:]\s*(\d+)/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}

const VERDICT_GAP_HIGH = Number(process.env.VALUE_RATIO_GAP_HIGH || "1.5");
const VERDICT_GAP = Number(process.env.VALUE_RATIO_GAP || "1.15");
const VERDICT_FAIR = Number(process.env.VALUE_RATIO_FAIR || "0.95");

function verdictFor(ratio: number): ValueVerdict {
  if (ratio >= VERDICT_GAP_HIGH) return "gap_high";
  if (ratio >= VERDICT_GAP) return "gap";
  if (ratio >= VERDICT_FAIR) return "fair";
  return "market_high";
}

function outcome(
  label: ValueOutcome["label"],
  modelPct: number,
  impliedProb: number,
): ValueOutcome {
  const impliedPct = impliedProb * 100;
  // Guard divide-by-zero; an unpriced outcome can't show a meaningful gap.
  const ratio = impliedPct > 0 ? modelPct / impliedPct : 0;
  return {
    label,
    modelProb: Math.round(modelPct),
    impliedProb: Math.round(impliedPct),
    edgeRatio: Math.round(ratio * 100) / 100,
    verdict: verdictFor(ratio),
  };
}

/**
 * model-vs-market analysis per fixture that has BOTH a prediction and odds.
 * Returns {} when no odds key is set or the feed is unavailable.
 */
export async function getMatchValues(
  fixtures: Match[],
  predictions: Record<
    string,
    {
      winProb: { home: number; draw: number; away: number };
      score?: string;
      detail?: any;
    }
  >,
): Promise<Record<string, ValueAnalysis>> {
  // Allow a new upstream fetch only when a match kicks off within the window —
  // that's when capturing odds movement matters. Otherwise we just serve cache.
  const now = Date.now();
  const matchNear = fixtures.some((f) => {
    if (!f.kickoffUtc) return false;
    const k = new Date(f.kickoffUtc).getTime();
    return !Number.isNaN(k) && k > now && k - now <= FETCH_WINDOW_MS;
  });
  const cache = await getRawEvents(matchNear);
  if (!cache || !cache.events.length) return {};
  const capturedAt = new Date(cache.ts).toISOString();
  const out: Record<string, ValueAnalysis> = {};
  const closingUpdate: Record<string, MarketProbs> = {};
  for (const f of fixtures) {
    const ev = findEvent(cache.events, f);
    if (!ev) continue;
    const h2h = devigH2H(ev, f);
    if (!h2h) continue;
    // Record the market's implied probs as this match's closing line (for the
    // model-vs-market track record). Keep updating until kickoff; the last
    // write before kickoff is the closing line.
    closingUpdate[f.id] = { home: h2h.team1, draw: h2h.draw, away: h2h.team2 };

    const pred = predictions[f.id];
    if (!pred) continue; // value panel needs a prediction; closing line doesn't
    const outcomes: ValueOutcome[] = [
      outcome("team1", pred.winProb.home, h2h.team1),
      outcome("draw", pred.winProb.draw, h2h.draw),
      outcome("team2", pred.winProb.away, h2h.team2),
    ];
    // Top-line verdict = the outcome where the model most exceeds the market.
    const top = outcomes.reduce((a, b) => (b.edgeRatio > a.edgeRatio ? b : a));

    // Asian handicap (让球) — implied probs + the model's directional lean.
    const score = parseScore(pred.score);
    const hc = devigHandicap(ev, f);
    let handicap: ValueHandicap | undefined;
    if (hc) {
      const modelHome = score ? score[0] + hc.line > score[1] : null;
      handicap = {
        line: hc.line,
        homeProb: Math.round(hc.home * 100),
        awayProb: Math.round(hc.away * 100),
        modelHome,
      };
    }

    // Over/Under (大小球) — implied probs + the model's lean (from score, else field).
    const tt = devigTotals(ev);
    let totals: ValueTotals | undefined;
    if (tt) {
      const ou = String(pred.detail?.prediction?.over_under_2_5 ?? "").toLowerCase();
      const modelOver = score
        ? score[0] + score[1] > tt.line
        : ou === "over"
          ? true
          : ou === "under"
            ? false
            : null;
      totals = {
        line: tt.line,
        overProb: Math.round(tt.over * 100),
        underProb: Math.round(tt.under * 100),
        modelOver,
      };
    }

    out[f.id] = {
      matchId: f.id,
      capturedAt,
      books: h2h.books,
      outcomes,
      topVerdict: top.verdict,
      handicap,
      totals,
    };
  }

  // Merge closing lines (preserve those that have since dropped out of the feed).
  if (Object.keys(closingUpdate).length > 0) {
    const existing = (await redisGetJson<Record<string, MarketProbs>>(CLOSE_KEY).catch(() => null)) ?? {};
    await redisSetJson(CLOSE_KEY, { ...existing, ...closingUpdate }).catch(() => {});
  }
  return out;
}

export interface MarketProbs {
  home: number;
  draw: number;
  away: number;
}

// Closing-line implied probabilities per match id (for grading model vs market).
export async function getClosingLines(): Promise<Record<string, MarketProbs>> {
  return (await redisGetJson<Record<string, MarketProbs>>(CLOSE_KEY).catch(() => null)) ?? {};
}

/**
 * Market-implied title (champion) probabilities, ranked. Entertainment only.
 * Throttled to ~once/day (and under the same monthly credit cap). Returns the
 * cached list on staleness/failure, or [] when no key.
 */
export async function getChampionOdds(): Promise<ChampionOdd[]> {
  const key = (process.env.ODDS_API_KEY || "").trim();
  if (!key) return [];
  const cached = await redisGetJson<{ ts: number; teams: ChampionOdd[] }>(CHAMP_KEY).catch(
    () => null,
  );
  const now = Date.now();
  if (cached && now - cached.ts < CHAMP_THROTTLE_MS) return cached.teams;
  if (!(await underMonthlyCap(now))) return cached?.teams ?? [];

  const url = `${CHAMP_URL}?apiKey=${encodeURIComponent(key)}&regions=${ODDS_REGION}&markets=outrights&oddsFormat=decimal`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`champ ${res.status}`);
    const data: any = await res.json();
    const ev = Array.isArray(data) && data[0] ? data[0] : null;
    // Median decimal price per team across bookmakers.
    const prices: Record<string, number[]> = {};
    for (const bk of ev?.bookmakers ?? []) {
      const m = (bk?.markets ?? []).find((x: any) => x?.key === "outrights");
      for (const o of m?.outcomes ?? []) {
        const n = String(o?.name ?? "");
        const p = Number(o?.price);
        if (n && p > 1) (prices[n] = prices[n] || []).push(p);
      }
    }
    const raw = Object.entries(prices)
      .map(([team, ps]) => ({ team, imp: 1 / (median(ps) as number) }))
      .filter((r) => Number.isFinite(r.imp));
    const sum = raw.reduce((s, r) => s + r.imp, 0) || 1; // de-vig across the field
    const teams = raw
      .map((r) => ({ team: r.team, prob: Math.round((r.imp / sum) * 1000) / 10 }))
      .sort((a, b) => b.prob - a.prob);
    if (teams.length) {
      await redisSetJson(CHAMP_KEY, { ts: now, teams }).catch(() => {});
      await bumpMonthly(now, creditsUsed(res, 1)); // outrights = 1
    }
    return teams;
  } catch {
    return cached?.teams ?? [];
  } finally {
    clearTimeout(timer);
  }
}
