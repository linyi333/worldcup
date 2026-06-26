// 竞彩组合分析引擎 — pure function, no I/O.
// 纯概率分析，不构成任何投注建议。

import type { Match, Prediction, ValueAnalysis, MatchResult } from "./types";
import type { StatPrediction } from "./statModel";
import { teamName } from "./teams";

export type JcPlay = "胜平负" | "让球胜平负" | "总进球";
export type LegRole = "value" | "anchor" | "skip";

const EDGE_VALUE = 0.03; // model sees ≥3% edge
const HIGH_HIT = 0.62;   // modelProb ≥ 62%

// ── Match stakes (qualification status) ─────────────────────────────────────
// "qualified"  — confirmed in top-2, nothing at stake, likely to rotate
// "eliminated" — mathematically out, dead rubber
// "must_win"   — draw not enough, maximum desperation
// "need_result"— win or draw advances them
// "live"       — still in the running but situation unclear

export type StakeLevel = "qualified" | "eliminated" | "must_win" | "need_result" | "live";

export interface TeamStakeInfo {
  level: StakeLevel;
  detail: string; // human-readable explanation
}

// Derives a team's current group-stage stakes from fixtures + results.
// Works the same way as buildGroupContext() on the backend, ported to the frontend.
function getTeamStake(
  team: string,
  fixtures: Match[],
  results: Record<string, MatchResult>,
): TeamStakeInfo {
  const groupFixtures = fixtures.filter(
    (f) => f.stage === "group" && (f.team1 === team || f.team2 === team),
  );
  if (groupFixtures.length === 0) return { level: "live", detail: "" };

  const groupName = groupFixtures[0].group!;
  const allGroupF = fixtures.filter((f) => f.stage === "group" && f.group === groupName);
  const TOTAL = 3; // each team plays 3 group games

  const rows: Record<string, { pts: number; played: number; gf: number; ga: number }> = {};
  for (const f of allGroupF) {
    for (const t of [f.team1, f.team2]) {
      if (!rows[t]) rows[t] = { pts: 0, played: 0, gf: 0, ga: 0 };
    }
    const r = results[f.id];
    if (!r) continue;
    const h = rows[f.team1]!, a = rows[f.team2]!;
    h.played++; a.played++;
    h.gf += r.homeScore; h.ga += r.awayScore;
    a.gf += r.awayScore; a.ga += r.homeScore;
    if (r.homeScore > r.awayScore) h.pts += 3;
    else if (r.awayScore > r.homeScore) a.pts += 3;
    else { h.pts++; a.pts++; }
  }

  const myRow = rows[team];
  if (!myRow) return { level: "live", detail: "" };
  const gLeft = TOTAL - myRow.played;

  const sorted = Object.entries(rows)
    .map(([t, r]) => ({ team: t, ...r, gLeft: TOTAL - r.played }))
    .sort((a, b) => (b.pts - a.pts) || ((b.gf - b.ga) - (a.gf - a.ga)));

  const maxReachable = sorted.map((r) => r.pts + r.gLeft * 3);
  const thirdMax = maxReachable[2] ?? 0;
  const secondPts = sorted[1]?.pts ?? 0;
  const myMax = myRow.pts + gLeft * 3;

  // Already confirmed top-2
  if (myRow.pts > thirdMax) {
    return { level: "qualified", detail: `已确定出线（${myRow.pts}分，3名最多${thirdMax}分），大概率轮换阵容` };
  }
  // Played all games
  if (gLeft === 0) {
    const rank = sorted.findIndex((r) => r.team === team);
    return rank < 2
      ? { level: "qualified", detail: "小组赛结束，已出线" }
      : { level: "eliminated", detail: "小组赛结束，已出局" };
  }
  // Mathematically eliminated
  if (myMax < secondPts) {
    return { level: "eliminated", detail: `数学出局（最多${myMax}分，2名已有${secondPts}分）` };
  }
  // Draw not enough — must win
  if (myRow.pts + 1 < secondPts) {
    return { level: "must_win", detail: `必须赢球（平局得${myRow.pts + 1}分仍低于2名${secondPts}分），全力以赴` };
  }
  return { level: "need_result", detail: `平局或胜利均可出线（当前${myRow.pts}分，需追赶2名${secondPts}分）` };
}

export interface MatchInputData {
  matchId: string;
  homeName: string;
  awayName: string;
  homeRaw: string; // raw English team ID (e.g. "Turkey") for Kalshi matching
  awayRaw: string;
  modelH2H: { home: number; draw: number; away: number }; // 0..1
  impliedH2H: { home: number; draw: number; away: number }; // de-vigged market
  handicap?: {
    line: number;
    homeImplied: number;
    awayImplied: number;
    homeModel: number;
    awayModel: number;
  };
  totals?: { line: number; overModel: number; overImplied: number };
  predictedScore?: string;
  confidence?: "高" | "中" | "低";
  oneLiner?: string; // AI's one-line reasoning for the match
  homeStake?: TeamStakeInfo;
  awayStake?: TeamStakeInfo;
}

// Kalshi live price data (from /api/worldcup/kalshi)
export interface KalshiPrice {
  bid: number; // YES bid, 0-1
  ask: number; // YES ask, 0-1
  mid: number; // (bid+ask)/2
}

export interface KalshiMatchData {
  eventTicker: string;
  team1: string; // first team in Kalshi event title
  team2: string;
  team1Win: KalshiPrice;
  draw: KalshiPrice | null;
  team2Win: KalshiPrice;
}

export interface MatchLegPlan {
  matchId: string;
  homeName: string;
  awayName: string;
  play: JcPlay;
  selection: string;
  selectionLabel: string;
  modelProb: number;
  impliedProb: number;
  decimalOdds: number;
  edge: number;
  role: LegRole;
  note?: string;
}

export interface CombinationPlan {
  tag: "highHitRate" | "value" | "highOdds";
  structure: string;
  structureDetail: string[];
  legs: MatchLegPlan[];
  count: number;
  pCash: number;      // P(≥1 ticket hits)
  aggregateEV: number; // EV per unit (e.g. -0.31 = -31% return rate)
  note?: string;
}

export interface CombinationAnalysis {
  perMatch: MatchLegPlan[];
  combinations: CombinationPlan[];
  skipped: { matchId: string; homeName: string; awayName: string; reason: string }[];
}

// Re-settle predictedScore against a handicap line.
function handicapSettles(score: string, line: number, sel: "home" | "away"): "home" | "draw" | "away" {
  const [h, a] = score.split("-").map(Number);
  if (isNaN(h) || isNaN(a)) return sel;
  const adj = h + line - a; // positive = home covers
  if (adj > 0) return "home";
  if (adj < 0) return "away";
  return "draw";
}

// P(≥ minK of N legs hit) via DP.
function pAtLeastK(probs: number[], minK: number): number {
  let dp = [1.0];
  for (const p of probs) {
    const next = new Array(dp.length + 1).fill(0);
    for (let j = 0; j < dp.length; j++) {
      next[j] += dp[j] * (1 - p);
      next[j + 1] += dp[j] * p;
    }
    dp = next;
  }
  let fail = 0;
  for (let j = 0; j < Math.min(minK, dp.length); j++) fail += dp[j];
  return Math.max(0, Math.min(1, 1 - fail));
}

function nCk(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

function kSubsets(indices: number[], k: number): number[][] {
  if (k === 1) return indices.map((x) => [x]);
  const out: number[][] = [];
  for (let i = 0; i <= indices.length - k; i++) {
    for (const rest of kSubsets(indices.slice(i + 1), k - 1)) {
      out.push([indices[i], ...rest]);
    }
  }
  return out;
}

function computeMetrics(
  legs: MatchLegPlan[],
  structureDetail: string[],
): { count: number; pCash: number; aggregateEV: number } {
  const n = legs.length;
  const idxs = Array.from({ length: n }, (_, i) => i);
  const ks = structureDetail.map((s) => {
    const m = s.match(/^(\d+)串1$/);
    return m ? parseInt(m[1]) : 1;
  });

  let totalCount = 0;
  let totalExpRet = 0;

  for (const k of ks) {
    const subs = k === 1 ? idxs.map((i) => [i]) : kSubsets(idxs, k);
    totalCount += subs.length;
    for (const sub of subs) {
      const p = sub.reduce((acc, i) => acc * legs[i].modelProb, 1);
      const odds = sub.reduce((acc, i) => acc * legs[i].decimalOdds, 1);
      totalExpRet += p * odds;
    }
  }

  const minK = Math.min(...ks);
  const pCash = pAtLeastK(
    legs.map((l) => l.modelProb),
    minK,
  );
  const ev = totalCount > 0 ? (totalExpRet - totalCount) / totalCount : -1;
  return { count: totalCount, pCash, aggregateEV: ev };
}

function pickBestPlay(inp: MatchInputData): Omit<MatchLegPlan, "matchId" | "homeName" | "awayName"> | null {
  // -- 1. 让球胜平负 (preference #1) --
  if (inp.handicap) {
    const { line, homeImplied, awayImplied, homeModel, awayModel } = inp.handicap;
    const sel: "home" | "away" = homeModel >= awayModel ? "home" : "away";
    const mp = sel === "home" ? homeModel : awayModel;
    const ip = sel === "home" ? homeImplied : awayImplied;
    const edge = mp - ip;

    let trap = false;
    if (inp.predictedScore) {
      const settles = handicapSettles(inp.predictedScore, line, sel);
      if (settles !== sel) trap = true;
    }

    if (!trap && (mp >= HIGH_HIT || edge >= EDGE_VALUE)) {
      const sign = line > 0 ? `+${line}` : `${line}`;
      const label =
        sel === "home"
          ? `${inp.homeName}(${sign})胜`
          : `${inp.awayName}(${-line > 0 ? "+" : ""}${-line})胜`;
      return {
        play: "让球胜平负",
        selection: sel,
        selectionLabel: label,
        modelProb: mp,
        impliedProb: ip,
        decimalOdds: Math.max(1.01, 1 / ip),
        edge,
        role: edge >= EDGE_VALUE ? "value" : "anchor",
      };
    }
  }

  // -- 2. 总进球 (preference #2) --
  if (inp.totals) {
    const { line, overModel, overImplied } = inp.totals;
    const underModel = 1 - overModel;
    const underImplied = 1 - overImplied;
    const useOver = overModel > underModel;
    const mp = useOver ? overModel : underModel;
    const ip = useOver ? overImplied : underImplied;
    const edge = mp - ip;
    if (mp >= HIGH_HIT || edge >= EDGE_VALUE) {
      return {
        play: "总进球",
        selection: useOver ? "over" : "under",
        selectionLabel: useOver ? `进球${line}以上(3-5球区间)` : `进球${line}以下(0-2球区间)`,
        modelProb: mp,
        impliedProb: ip,
        decimalOdds: Math.max(1.01, 1 / ip),
        edge,
        role: edge >= EDGE_VALUE ? "value" : "anchor",
      };
    }
  }

  // -- 3. 胜平负 (fallback) --
  const cands = [
    { sel: "home" as const, label: `${inp.homeName}胜`, mp: inp.modelH2H.home, ip: inp.impliedH2H.home },
    { sel: "draw" as const, label: "平局", mp: inp.modelH2H.draw, ip: inp.impliedH2H.draw },
    { sel: "away" as const, label: `${inp.awayName}胜`, mp: inp.modelH2H.away, ip: inp.impliedH2H.away },
  ];
  const best = cands.reduce((a, b) => (a.mp > b.mp ? a : b));
  const edge = best.mp - best.ip;
  const role: LegRole = edge >= EDGE_VALUE ? "value" : best.mp >= HIGH_HIT ? "anchor" : "skip";
  if (role === "skip") return null;
  return {
    play: "胜平负",
    selection: best.sel,
    selectionLabel: best.label,
    modelProb: best.mp,
    impliedProb: best.ip,
    decimalOdds: Math.max(1.01, 1 / best.ip),
    edge,
    role,
    note: edge < -0.05 ? "市场充分定价，仅作参考" : undefined,
  };
}

export function recommendCombination(inputs: MatchInputData[]): CombinationAnalysis {
  const perMatch: MatchLegPlan[] = [];
  const skipped: CombinationAnalysis["skipped"] = [];

  for (const inp of inputs) {
    const leg = pickBestPlay(inp);
    if (!leg) {
      skipped.push({ matchId: inp.matchId, homeName: inp.homeName, awayName: inp.awayName, reason: "无高概率或概率优势腿" });
      continue;
    }
    perMatch.push({ matchId: inp.matchId, homeName: inp.homeName, awayName: inp.awayName, ...leg });
  }

  const anchors = perMatch.filter((l) => l.role !== "skip").sort((a, b) => b.modelProb - a.modelProb);
  const valueLegs = perMatch.filter((l) => l.role === "value").sort((a, b) => b.edge - a.edge);
  const N = anchors.length;
  const combinations: CombinationPlan[] = [];

  // -- Main structure --
  if (N >= 1) {
    let structure: string;
    let detail: string[];
    if (N === 1) { structure = "单场参考"; detail = ["单场"]; }
    else if (N === 2) { structure = "二串一"; detail = ["2串1"]; }
    else if (N === 3) { structure = "自由过关 · 2串1"; detail = ["2串1"]; }
    else if (N === 4) { structure = "自由过关 · 2串1+3串1"; detail = ["2串1", "3串1"]; }
    else { structure = `自由过关 · 3串1`; detail = ["3串1"]; }

    const { count, pCash, aggregateEV } = computeMetrics(anchors, detail);
    const minK = parseInt(detail[0]);
    combinations.push({
      tag: "highHitRate",
      structure,
      structureDetail: detail,
      legs: anchors,
      count,
      pCash,
      aggregateEV,
      note: N >= 3 ? `容错结构：任意 ${minK} 场命中即可产生回报` : undefined,
    });

    // All-in line for N ≥ 3
    if (N >= 3) {
      const allDetail = [`${N}串1`];
      const m = computeMetrics(anchors, allDetail);
      combinations.push({
        tag: "highOdds",
        structure: `全关 ${N}串1`,
        structureDetail: allDetail,
        legs: anchors,
        ...m,
        note: "全场命中赔付最高，概率最低",
      });
    }
  }

  // -- 概率优势组合 --
  if (valueLegs.length >= 1) {
    const detail = valueLegs.length === 1 ? ["单场"] : ["2串1"];
    const m = computeMetrics(valueLegs, detail);
    combinations.push({
      tag: "value",
      structure: valueLegs.length === 1 ? "概率优势 · 单场" : "概率优势组合",
      structureDetail: detail,
      legs: valueLegs,
      ...m,
      note: "模型概率高于市场隐含概率的场次",
    });
  }

  // Rank: highHitRate first, value second, highOdds last
  combinations.sort((a, b) => {
    const order = { highHitRate: 0, value: 1, highOdds: 2 };
    return order[a.tag] - order[b.tag];
  });

  return { perMatch, combinations, skipped };
}

// ---------------------------------------------------------------------------
// US-market (Kalshi) per-outcome contract analysis.
// Strategy: compare ALL three outcomes (home/draw/away YES contracts) against
// market price. The best bet is not necessarily on who you predict to win —
// it's the contract where model_prob − buy_price is highest.
// Example: model says 56% Japan, 24% draw, 20% Sweden.
//   Market: Japan 50¢, Draw 20¢, Sweden 22¢.
//   Draw EV on capital = +13% > Japan EV on capital = +9% — draw is the better contract.
// ---------------------------------------------------------------------------

const HALF_SPREAD = 0.0125; // half of ~2.5pp typical Kalshi bid/ask

// Per-contract math for one outcome (YES contract)
export interface KalshiOutcome {
  sel: "home" | "draw" | "away";
  label: string;
  modelProb: number;       // model's probability (0..1)
  impliedProb: number;     // market mid implied prob (0..1)
  bidPrice: number;        // YES bid (0 when using bookmaker estimate)
  buyPrice: number;        // YES ask (what you actually pay)
  ev: number;              // modelProb − buyPrice (raw edge)
  evOnCapital: number;     // ev / buyPrice — expected return per unit invested
  rewardIfCorrect: number; // (1 − buyPrice) / buyPrice — profit% if correct
  recoveryRatio: number;   // buyPrice / (1 − buyPrice) — wins needed to recover 1 loss
  // Kelly Criterion: optimal fraction of bankroll for this bet
  // f* = (model_prob − buy_price) / (1 − buy_price)
  // = 0 when model_prob ≤ buy_price (no edge → don't bet)
  kellyFraction: number;
  action: "buy" | "watch" | "skip";
}

// Per-match signal: all 3 outcomes with full contract math
export interface KalshiSignal {
  matchId: string;
  homeName: string;
  awayName: string;
  outcomes: KalshiOutcome[]; // home / draw / away, sorted by evOnCapital desc
  bestOutcome: KalshiOutcome | null; // highest positive EV, null if all negative
  hasValidSignal: boolean;   // any outcome with ev ≥ ACT_EV_THRESHOLD
  predictedScore?: string;
  confidence?: "高" | "中" | "低";
  oneLiner?: string;
  homeStake?: TeamStakeInfo;
  awayStake?: TeamStakeInfo;
  hasStakeImbalance: boolean;
  // "kalshi" = live prices from Kalshi API; "estimated" = derived from bookmaker odds
  priceSource: "kalshi" | "estimated";
}

const ACT_EV = 0.045;   // ev ≥4.5pp = signal worth acting on
const WATCH_EV = 0.015; // ev ≥1.5pp = watch (borderline)

// Normalize for Kalshi team-name matching (mirrors grade.ts norm())
const KALSHI_NORM_ALIASES: Record<string, string> = {
  turkiye: "turkey",
  congodr: "drcongo",
  irian: "iran",           // "IR Iran" → strip non-alpha → "irian"
  iranislamicrepublic: "iran",
  ivorycoast: "cotedivoire",
  capeverde: "caboverde",
  unitedstates: "usa",
  korearepublic: "southkorea",
  northmacedonia: "macedonia",
};

function normKalshi(name: string): string {
  const base = String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return KALSHI_NORM_ALIASES[base] ?? base;
}

function findKalshiMatch(
  inp: MatchInputData,
  kalshiData: KalshiMatchData[],
): { data: KalshiMatchData; swapped: boolean } | null {
  const normHome = normKalshi(inp.homeRaw);
  const normAway = normKalshi(inp.awayRaw);
  for (const k of kalshiData) {
    const normK1 = normKalshi(k.team1);
    const normK2 = normKalshi(k.team2);
    if (normHome === normK1 && normAway === normK2) return { data: k, swapped: false };
    if (normHome === normK2 && normAway === normK1) return { data: k, swapped: true };
  }
  return null;
}

export function buildKalshiSignals(
  inputs: MatchInputData[],
  kalshiData?: KalshiMatchData[],
): KalshiSignal[] {
  const signals: KalshiSignal[] = inputs.map((inp) => {
    // Try to find real Kalshi prices for this match
    const kalshiMatch = kalshiData ? findKalshiMatch(inp, kalshiData) : null;
    const priceSource: KalshiSignal["priceSource"] = kalshiMatch ? "kalshi" : "estimated";

    // Build per-outcome price info: prefer Kalshi ask/mid, fall back to bookmaker implied + spread
    const priceFor = (sel: "home" | "draw" | "away"): { bid: number; ask: number; mid: number } => {
      if (kalshiMatch) {
        const { data: kd, swapped } = kalshiMatch;
        if (sel === "draw") return kd.draw ?? { bid: 0, ask: inp.impliedH2H.draw + HALF_SPREAD, mid: inp.impliedH2H.draw };
        if (sel === "home") return swapped ? kd.team2Win : kd.team1Win;
        return swapped ? kd.team1Win : kd.team2Win;
      }
      const ip = sel === "home" ? inp.impliedH2H.home : sel === "draw" ? inp.impliedH2H.draw : inp.impliedH2H.away;
      return { bid: 0, ask: ip + HALF_SPREAD, mid: ip };
    };

    const raw = [
      { sel: "home" as const, label: `${inp.homeName}胜`, mp: inp.modelH2H.home },
      { sel: "draw" as const, label: "平局",               mp: inp.modelH2H.draw },
      { sel: "away" as const, label: `${inp.awayName}胜`, mp: inp.modelH2H.away },
    ];

    const outcomes: KalshiOutcome[] = raw.map((o) => {
      const px = priceFor(o.sel);
      const buyPrice = px.ask;
      const impliedProb = px.mid;
      const bidPrice = px.bid;
      const ev = o.mp - buyPrice;
      const evOnCapital = buyPrice > 0 ? ev / buyPrice : 0;
      const rewardIfCorrect = buyPrice < 1 ? (1 - buyPrice) / buyPrice : 0;
      const recoveryRatio = buyPrice < 1 ? buyPrice / (1 - buyPrice) : 99;
      const kellyFraction = Math.max(0, (o.mp - buyPrice) / Math.max(1 - buyPrice, 0.01)) / 2;
      const action: KalshiOutcome["action"] =
        ev >= ACT_EV ? "buy" : ev >= WATCH_EV ? "watch" : "skip";
      return {
        sel: o.sel, label: o.label, modelProb: o.mp, impliedProb,
        bidPrice, buyPrice, ev, evOnCapital, rewardIfCorrect, recoveryRatio,
        kellyFraction,
        action,
      };
    }).sort((a, b) => b.evOnCapital - a.evOnCapital);

    const positiveEV = outcomes.filter((o) => o.ev > 0);
    const bestOutcome = positiveEV.length > 0 ? positiveEV[0] : null;
    const hasValidSignal = outcomes.some((o) => o.action === "buy");

    const homeStake = inp.homeStake;
    const awayStake = inp.awayStake;
    const hasStakeImbalance = !!(
      homeStake?.level === "qualified" || homeStake?.level === "eliminated" ||
      awayStake?.level === "qualified" || awayStake?.level === "eliminated" ||
      homeStake?.level === "must_win"  || awayStake?.level === "must_win"
    );

    return {
      matchId: inp.matchId, homeName: inp.homeName, awayName: inp.awayName,
      outcomes, bestOutcome, hasValidSignal,
      predictedScore: inp.predictedScore, confidence: inp.confidence, oneLiner: inp.oneLiner,
      homeStake, awayStake, hasStakeImbalance, priceSource,
    };
  });

  return signals.sort((a, b) => {
    if (a.hasValidSignal !== b.hasValidSignal) return a.hasValidSignal ? -1 : 1;
    const aEV = a.bestOutcome?.evOnCapital ?? -999;
    const bEV = b.bestOutcome?.evOnCapital ?? -999;
    return bEV - aEV;
  });
}

// -- Builder: converts app data → MatchInputData[] for today's upcoming matches --
export function buildMatchInputs(
  fixtures: Match[],
  predictions: Record<string, Prediction>,
  values: Record<string, ValueAnalysis>,
  results: Record<string, MatchResult>,
  statPredictions: Record<string, StatPrediction | null>,
): MatchInputData[] {
  const now = Date.now();
  const out: MatchInputData[] = [];

  for (const m of fixtures) {
    if (!m.kickoffUtc) continue;
    const k = new Date(m.kickoffUtc).getTime();
    if (k <= now) continue; // already started or finished
    if (results[m.id]) continue; // already graded

    const pred = predictions[m.id];
    const val = values?.[m.id];
    if (!pred || !val || val.outcomes.length === 0) continue;

    const wp = pred.winProb;
    const modelH2H = { home: wp.home / 100, draw: wp.draw / 100, away: wp.away / 100 };

    const homeOC = val.outcomes.find((o) => o.label === "team1");
    const drawOC = val.outcomes.find((o) => o.label === "draw");
    const awayOC = val.outcomes.find((o) => o.label === "team2");
    if (!homeOC || !drawOC || !awayOC) continue;
    const impliedH2H = {
      home: homeOC.impliedProb / 100,
      draw: drawOC.impliedProb / 100,
      away: awayOC.impliedProb / 100,
    };

    let handicap: MatchInputData["handicap"];
    if (val.handicap) {
      const hc = val.handicap;
      handicap = {
        line: hc.line,
        homeImplied: hc.homeProb / 100,
        awayImplied: hc.awayProb / 100,
        homeModel: wp.home / 100,
        awayModel: wp.away / 100,
      };
    }

    let totals: MatchInputData["totals"];
    const stat = statPredictions[m.id];
    if (val.totals && stat) {
      const overImplied = val.totals.overProb / 100;
      totals = {
        line: val.totals.line,
        overModel: stat.over25 / 100,
        overImplied,
      };
    }

    const confMap: Record<string, "高" | "中" | "低"> = {
      high: "高", "medium-high": "高", medium: "中", low: "低",
    };

    out.push({
      matchId: m.id,
      homeName: teamName(m.team1, "zh"),
      awayName: teamName(m.team2, "zh"),
      homeRaw: m.team1,
      awayRaw: m.team2,
      modelH2H,
      impliedH2H,
      handicap,
      totals,
      predictedScore: pred.score,
      confidence: confMap[pred.confidence] ?? "中",
      oneLiner: pred.oneLiner,
      homeStake: m.stage === "group" ? getTeamStake(m.team1, fixtures, results) : undefined,
      awayStake: m.stage === "group" ? getTeamStake(m.team2, fixtures, results) : undefined,
    });
  }
  return out;
}
