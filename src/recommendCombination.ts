// 竞彩组合分析引擎 — pure function, no I/O.
// 纯概率分析，不构成任何投注建议。

import type { Match, Prediction, ValueAnalysis, MatchResult } from "./types";
import type { StatPrediction } from "./statModel";
import { teamName } from "./teams";

export type JcPlay = "胜平负" | "让球胜平负" | "总进球";
export type LegRole = "value" | "anchor" | "skip";

const EDGE_VALUE = 0.03; // model sees ≥3% edge
const HIGH_HIT = 0.62;   // modelProb ≥ 62%

export interface MatchInputData {
  matchId: string;
  homeName: string;
  awayName: string;
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
      modelH2H,
      impliedH2H,
      handicap,
      totals,
      predictedScore: pred.score,
      confidence: confMap[pred.confidence] ?? "中",
    });
  }
  return out;
}
