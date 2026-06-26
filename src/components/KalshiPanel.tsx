// 美国预测市场 (Kalshi) 合约分析面板
// 核心策略：Kelly准则 + 回本分析 + 三向对比。不构成任何建议。

import React, { useState } from "react";
import { Card } from "./Card";
import type { KalshiOutcome, KalshiSignal } from "../recommendCombination";

// ── Formatters ───────────────────────────────────────────────────────────────

function pct(v: number, d = 0) {
  return `${(v * 100).toFixed(d)}%`;
}
function evLabel(v: number) {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}
function cents(v: number) {
  return `${Math.round(v * 100)}¢`;
}

// ── Outcome card ─────────────────────────────────────────────────────────────

const ACTION_BORDER: Record<KalshiOutcome["action"], string> = {
  buy:   "border-emerald-300 bg-emerald-50/60",
  watch: "border-blue-200 bg-blue-50/40",
  skip:  "border-slate-200 bg-white",
};
const ACTION_LABEL: Record<KalshiOutcome["action"], string> = {
  buy:   "✓ 有效信号",
  watch: "观察",
  skip:  "跳过",
};
const ACTION_TAG: Record<KalshiOutcome["action"], string> = {
  buy:   "bg-emerald-100 text-emerald-800 border-emerald-300",
  watch: "bg-blue-100 text-blue-700 border-blue-200",
  skip:  "bg-slate-100 text-slate-400 border-slate-200",
};

function OutcomeCard({
  o,
  isBest,
  isModelFavorite,
  isLive,
}: {
  o: KalshiOutcome;
  isBest: boolean;
  isModelFavorite: boolean;
  isLive: boolean;
}) {
  const isTrap = o.buyPrice >= 0.5 && o.ev < 0.03;
  const spread = isLive && o.bidPrice > 0 ? Math.round((o.buyPrice - o.bidPrice) * 100) : null;

  return (
    <div className={`rounded-lg border p-3 ${ACTION_BORDER[o.action]} ${isBest ? "ring-2 ring-emerald-400" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-noto-sans-sc font-semibold text-slate-800">{o.label}</span>
          {isLive && (
            <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 tabular-nums">
              {cents(o.bidPrice)} / {cents(o.buyPrice)}
              {spread !== null && spread > 0 && <span className="ml-1 opacity-60">±{spread}¢</span>}
            </span>
          )}
          {isModelFavorite && (
            <span className="rounded border border-[#2A398D]/30 bg-[#2A398D]/10 px-1.5 py-0.5 text-[10px] text-[#2A398D]">
              AI预测方向
            </span>
          )}
          {isBest && !isTrap && (
            <span className="rounded border border-emerald-400 bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 font-medium">
              ★ 最优合约
            </span>
          )}
          {isTrap && (
            <span className="rounded border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 font-medium">
              ⚠ 热门陷阱
            </span>
          )}
        </div>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${ACTION_TAG[o.action]}`}>
          {ACTION_LABEL[o.action]}
        </span>
      </div>

      {/* 4-metric row */}
      <div className="grid grid-cols-4 gap-2 text-center mb-3">
        <div className="rounded bg-white/70 border border-slate-100 px-1 py-1.5">
          <div className="text-lg font-bold tabular-nums text-[#2A398D]">{pct(o.buyPrice)}</div>
          <div className="text-[10px] text-slate-500 leading-tight">保本命中率</div>
          <div className="text-[10px] text-slate-400">{isLive ? "Ask买入价" : "（估算）"}</div>
        </div>
        <div className="rounded bg-white/70 border border-slate-100 px-1 py-1.5">
          <div className={`text-lg font-bold tabular-nums ${o.modelProb > o.buyPrice ? "text-emerald-600" : "text-rose-500"}`}>
            {pct(o.modelProb)}
          </div>
          <div className="text-[10px] text-slate-500 leading-tight">模型概率</div>
          <div className={`text-[10px] font-medium ${o.ev >= 0 ? "text-emerald-600" : "text-rose-400"}`}>
            {o.ev >= 0 ? "▲" : "▼"} {Math.abs(o.ev * 100).toFixed(1)}pp
          </div>
        </div>
        <div className="rounded bg-white/70 border border-slate-100 px-1 py-1.5">
          <div className="text-lg font-bold tabular-nums text-emerald-600">
            +{pct(o.rewardIfCorrect, 0)}
          </div>
          <div className="text-[10px] text-slate-500 leading-tight">命中收益</div>
          <div className="text-[10px] text-slate-400">未命中 −100%</div>
        </div>
        <div className={`rounded border px-1 py-1.5 ${o.recoveryRatio > 1.5 ? "bg-amber-50/70 border-amber-200" : "bg-white/70 border-slate-100"}`}>
          <div className={`text-lg font-bold tabular-nums ${o.recoveryRatio > 1.5 ? "text-amber-600" : "text-emerald-600"}`}>
            {o.recoveryRatio < 1 ? `${(1 / o.recoveryRatio).toFixed(1)}x` : `${o.recoveryRatio.toFixed(2)}x`}
          </div>
          <div className="text-[10px] text-slate-500 leading-tight">
            {o.recoveryRatio < 1 ? "1次覆盖亏损" : "回本需N胜"}
          </div>
          <div className="text-[10px] text-slate-400">
            {o.recoveryRatio < 1 ? `赢1=抵${(1/o.recoveryRatio).toFixed(1)}次亏` : `亏1需赢${o.recoveryRatio.toFixed(2)}次`}
          </div>
        </div>
      </div>

      {/* Probability bar comparison */}
      <div className="space-y-1 mb-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-12 text-right text-slate-400 shrink-0">保本线</span>
          <div className="relative flex-1 h-2.5 rounded bg-slate-200 overflow-hidden">
            <div className="absolute left-0 top-0 h-full rounded bg-slate-400"
              style={{ width: pct(o.buyPrice) }} />
          </div>
          <span className="w-8 tabular-nums text-slate-500 font-medium">{pct(o.buyPrice)}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-12 text-right text-slate-400 shrink-0">模型</span>
          <div className="relative flex-1 h-2.5 rounded bg-slate-200 overflow-hidden">
            <div className={`absolute left-0 top-0 h-full rounded ${o.ev >= 0 ? "bg-[#2A398D]" : "bg-rose-400"}`}
              style={{ width: pct(o.modelProb) }} />
          </div>
          <span className={`w-8 tabular-nums font-medium ${o.ev >= 0 ? "text-[#2A398D]" : "text-rose-500"}`}>
            {pct(o.modelProb)}
          </span>
        </div>
      </div>

      {/* Kelly + EV row */}
      <div className="flex items-center justify-between rounded bg-white/80 border border-slate-100 px-2 py-1.5 text-xs">
        <div>
          <span className="text-slate-500">期望回报率：</span>
          <span className={`font-bold tabular-nums ${o.evOnCapital >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
            {evLabel(o.evOnCapital)} / 单位资金
          </span>
        </div>
        <div>
          <span className="text-slate-500">Kelly仓位（½）：</span>
          <span className={`font-bold tabular-nums ${o.kellyFraction > 0 ? "text-emerald-600" : "text-slate-400"}`}>
            {o.kellyFraction > 0.001 ? pct(o.kellyFraction, 1) + " 本金" : "0 — 不投入"}
          </span>
        </div>
      </div>

      {/* Trap explanation */}
      {isTrap && (
        <div className="mt-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] text-amber-800">
          <strong>热门陷阱：</strong>买入价 {cents(o.buyPrice)}，赢只得 {cents(1-o.buyPrice)}（+{pct(o.rewardIfCorrect,0)}）。
          一次错误需 {o.recoveryRatio.toFixed(1)} 次命中才回本。模型仅高出保本线 {(o.ev*100).toFixed(1)}pp，Kelly建议仓位极低。
        </div>
      )}

      {/* Buy interpretation */}
      {o.action === "buy" && !isTrap && (
        <div className="mt-2 rounded bg-emerald-50 border border-emerald-200 px-2 py-1.5 text-[11px] text-emerald-800">
          命中（{pct(o.modelProb)} 概率）→ <strong>+{pct(o.rewardIfCorrect,0)}</strong>
          未命中（{pct(1-o.modelProb)} 概率）→ <strong>−100%</strong>
          1次命中可抵 {(1/o.recoveryRatio).toFixed(1)} 次亏损
        </div>
      )}
    </div>
  );
}

// ── Match card ───────────────────────────────────────────────────────────────

function MatchCard({ sig }: { sig: KalshiSignal }) {
  const [open, setOpen] = useState(sig.hasValidSignal);
  const isLive = sig.priceSource === "kalshi";

  const modelFavoriteSel = [...sig.outcomes].sort((a, b) => b.modelProb - a.modelProb)[0]?.sel;

  return (
    <Card className={`overflow-hidden border ${sig.hasValidSignal ? "border-emerald-300" : "border-slate-200"}`}>
      {/* Banner */}
      <div className={`px-4 py-2 flex items-center justify-between ${sig.hasValidSignal ? "bg-emerald-600" : "bg-slate-100"}`}>
        <span className={`text-sm font-bold ${sig.hasValidSignal ? "text-white" : "text-slate-400"}`}>
          {sig.hasValidSignal ? "✓ 有合约信号" : "✗ 无有效信号"}
        </span>
        {sig.bestOutcome && sig.hasValidSignal && (
          <span className="text-xs text-emerald-100 tabular-nums">
            最优：{sig.bestOutcome.label}　期望 {evLabel(sig.bestOutcome.evOnCapital)}　Kelly {pct(sig.bestOutcome.kellyFraction,1)} 本金
          </span>
        )}
      </div>

      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="min-w-0">
          <div className="font-noto-sans-sc font-semibold text-slate-800 text-sm flex items-center gap-2">
            {sig.homeName} vs {sig.awayName}
            {isLive ? (
              <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 font-medium">Kalshi实时</span>
            ) : (
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">估算</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 flex items-center gap-2">
            {sig.predictedScore && <>AI预测比分 <span className="font-medium text-slate-700">{sig.predictedScore}</span></>}
            {sig.confidence && (
              <span className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px]">
                AI信心 {sig.confidence}
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 text-slate-300">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-2 space-y-3">
          {/* Stakes imbalance warning */}
          {sig.hasStakeImbalance && (sig.homeStake || sig.awayStake) && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 space-y-1.5">
              <div className="font-semibold text-orange-800 text-xs">⚡ 出线压力不对等 — 影响市场定价</div>
              {[
                { name: sig.homeName, stake: sig.homeStake },
                { name: sig.awayName, stake: sig.awayStake },
              ].filter((t) => t.stake).map((t) => {
                const s = t.stake!;
                const color =
                  s.level === "qualified"   ? "text-slate-500" :
                  s.level === "eliminated"  ? "text-slate-400" :
                  s.level === "must_win"    ? "text-red-700 font-semibold" :
                  s.level === "need_result" ? "text-orange-700" : "text-slate-600";
                const icon =
                  s.level === "qualified"  ? "😴" :
                  s.level === "eliminated" ? "💀" :
                  s.level === "must_win"   ? "🔥" :
                  s.level === "need_result"? "⚡" : "📊";
                return (
                  <div key={t.name} className={`text-xs font-noto-sans-sc ${color}`}>
                    {icon} <strong>{t.name}</strong>：{s.detail}
                  </div>
                );
              })}
              <p className="text-[11px] text-orange-700 border-t border-orange-200 pt-1.5 leading-relaxed">
                已出线方大概率轮换主力，实际胜率低于市场定价；对手若全力出战，市场对热门方的定价可能偏高。
                参考上方合约数学时请结合此背景调整判断。
              </p>
            </div>
          )}

          {/* Insight note */}
          <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded px-3 py-2 leading-relaxed">
            <strong>阅读提示：</strong>
            三张合约按期望回报率排序（高→低）。
            "保本命中率"= 你需要赢多少次才能回本，越低越容易达到。
            "回本需N胜"= 亏1次需要赢几次才能收回，&gt;1.5x即为热门陷阱区域。
            Kelly仓位建议已折半，反映模型不确定性。
          </div>

          <div className="space-y-2">
            {sig.outcomes.map((o) => (
              <OutcomeCard
                key={o.sel}
                o={o}
                isBest={o.sel === sig.bestOutcome?.sel}
                isModelFavorite={o.sel === modelFavoriteSel}
                isLive={isLive}
              />
            ))}
          </div>

          {sig.oneLiner && (
            <div className="rounded bg-white border border-slate-100 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">AI 判断依据</div>
              <p className="text-xs text-slate-700 font-noto-sans-sc leading-relaxed">{sig.oneLiner}</p>
            </div>
          )}

          <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
            <strong>风险提示：</strong>
            每张合约未命中即亏失全部买入价。Kelly仓位基于模型概率，模型不包含实时阵容/伤情信息。
            建议先查"战绩"标签核实历史命中率，再决定参与规模。本分析仅供参考，不构成任何建议。
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  signals: KalshiSignal[];
  capturedAt?: string;
  isStale?: boolean;
}

const KalshiPanel: React.FC<Props> = ({ signals, capturedAt, isStale }) => {
  if (signals.length === 0) {
    return (
      <Card className="p-4 border-slate-200">
        <p className="text-sm text-slate-500">当日无可分析场次（需有预测及市场赔率数据）。</p>
      </Card>
    );
  }

  const validCount = signals.filter((s) => s.hasValidSignal).length;
  const liveCount  = signals.filter((s) => s.priceSource === "kalshi").length;
  const updatedAt  = capturedAt ? new Date(capturedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;

  return (
    <div className="space-y-4">
      {/* Data source banner */}
      <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 text-xs ${
        liveCount > 0
          ? (isStale ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800")
          : "border-slate-200 bg-slate-50 text-slate-500"
      }`}>
        <span className="text-base">{liveCount > 0 ? (isStale ? "⚠" : "🟢") : "🔵"}</span>
        <div className="flex-1 min-w-0">
          {liveCount > 0 ? (
            <>
              <span className="font-semibold">Kalshi 实时价格</span>
              {" — "}
              <span>{liveCount}/{signals.length} 场次已获取实时报价</span>
              {updatedAt && <span className="ml-2 opacity-70">更新于 {updatedAt}{isStale ? "（已缓存）" : ""}</span>}
            </>
          ) : (
            <>
              <span className="font-semibold">估算价格</span>
              {" — 正在加载 Kalshi 实时数据，当前使用博彩公司赔率估算"}
            </>
          )}
        </div>
        {liveCount > 0 && (
          <span className="shrink-0 rounded border border-emerald-400 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
            LIVE
          </span>
        )}
      </div>

      {/* Core principles */}
      <Card className="p-4 border-slate-200 space-y-2">
        <h3 className="font-semibold text-slate-700 text-sm">分析框架（Kelly准则）</h3>
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2">
            <div className="font-semibold text-amber-800 mb-1">⚠ 热门陷阱</div>
            <p className="text-amber-700 leading-relaxed">
              买入价高（如64¢）→ 回报低（+56%）→ 一次错误需1.78次命中回本。
              Kelly建议仓位趋近0。高概率≠好合约。
            </p>
          </div>
          <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2">
            <div className="font-semibold text-emerald-800 mb-1">✓ 冷门价值</div>
            <p className="text-emerald-700 leading-relaxed">
              买入价低（如19¢）→ 回报高（+426%）→ 一次命中抵消4次亏损。
              只需模型超出保本线，Kelly给出正仓位。
            </p>
          </div>
          <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2">
            <div className="font-semibold text-blue-800 mb-1">Kelly公式</div>
            <p className="text-blue-700 leading-relaxed">
              f* = (模型概率 − 买入价) / (1 − 买入价)<br />
              实际用½Kelly：降低模型误差风险。结果&gt;0才参与，=0即不投。
            </p>
          </div>
        </div>
        <p className="text-[10px] text-slate-400 border-t border-slate-100 pt-2">
          Kelly准则最大化长期本金增长率，避免过度下注导致破产。
          模型存在误差，½Kelly为安全边际。历史命中率见"战绩"标签。不构成任何建议。
        </p>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 py-3">
          <div className="text-2xl font-bold text-emerald-700">{validCount}</div>
          <div className="text-xs text-emerald-700 font-medium">有效信号</div>
          <div className="text-[10px] text-emerald-600">Kelly &gt; 0，可考虑参与</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white py-3">
          <div className="text-2xl font-bold text-slate-400">{signals.length - validCount}</div>
          <div className="text-xs text-slate-400">无有效信号</div>
          <div className="text-[10px] text-slate-300">Kelly = 0，跳过</div>
        </div>
      </div>

      {signals.map((s) => <MatchCard key={s.matchId} sig={s} />)}
    </div>
  );
};

export default KalshiPanel;
