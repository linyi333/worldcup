// 组合分析面板 — 纯概率分析展示，无任何赌博相关用词。
// Only rendered after passcode unlock; parent is responsible for the gate.

import React, { useState } from "react";
import { Card } from "./Card";
import type {
  CombinationAnalysis,
  CombinationPlan,
  MatchLegPlan,
} from "../recommendCombination";

const TAG_LABEL: Record<CombinationPlan["tag"], string> = {
  highHitRate: "高命中率组合",
  value: "概率优势组合",
  highOdds: "高赔付组合",
};

const TAG_CLS: Record<CombinationPlan["tag"], string> = {
  highHitRate: "bg-blue-50 text-blue-700 border-blue-200",
  value: "bg-emerald-50 text-emerald-700 border-emerald-200",
  highOdds: "bg-amber-50 text-amber-700 border-amber-200",
};

const ROLE_LABEL: Record<MatchLegPlan["role"], string> = {
  value: "优势腿",
  anchor: "高概率腿",
  skip: "跳过",
};

const ROLE_CLS: Record<MatchLegPlan["role"], string> = {
  value: "bg-emerald-50 text-emerald-700",
  anchor: "bg-blue-50 text-blue-700",
  skip: "bg-slate-100 text-slate-400",
};

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function evLabel(ev: number) {
  const sign = ev >= 0 ? "+" : "";
  return `期望回报 ${sign}${Math.round(ev * 100)}%`;
}

function evCls(ev: number) {
  return ev >= -0.05
    ? "text-emerald-700"
    : ev >= -0.2
    ? "text-amber-700"
    : "text-slate-500";
}

interface Props {
  analysis: CombinationAnalysis;
}

const CombinationPanel: React.FC<Props> = ({ analysis }) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  if (analysis.combinations.length === 0) {
    return (
      <Card className="p-4 border-slate-200">
        <p className="text-sm text-slate-500">
          当日无满足条件的场次（模型概率 ≥62% 或概率优势 ≥3%），暂无组合方案。
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Per-leg quick reference */}
      <Card className="p-4 border-slate-200">
        <h3 className="mb-3 font-semibold text-slate-700 text-sm">场次概率分析</h3>
        <div className="space-y-2">
          {analysis.perMatch.map((leg) => (
            <div
              key={leg.matchId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-800 font-noto-sans-sc">
                  {leg.homeName} vs {leg.awayName}
                </div>
                <div className="text-slate-500 mt-0.5">{leg.selectionLabel}</div>
                {leg.note && <div className="text-slate-400 italic">{leg.note}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ROLE_CLS[leg.role]}`}>
                  {ROLE_LABEL[leg.role]}
                </span>
                <span className="tabular-nums text-slate-600 font-medium">
                  模型 {pct(leg.modelProb)}
                </span>
                <span className="tabular-nums text-slate-400">
                  市场 {pct(leg.impliedProb)}
                </span>
                {leg.edge >= 0.01 && (
                  <span className="tabular-nums text-emerald-600 font-medium">
                    +{Math.round(leg.edge * 100)}%
                  </span>
                )}
              </div>
            </div>
          ))}
          {analysis.skipped.length > 0 && (
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer py-1">
                跳过 {analysis.skipped.length} 场（无高概率或概率优势）
              </summary>
              <ul className="pl-3 pt-1 space-y-0.5">
                {analysis.skipped.map((s) => (
                  <li key={s.matchId} className="font-noto-sans-sc">
                    {s.homeName} vs {s.awayName} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Card>

      {/* Combination plans */}
      {analysis.combinations.map((plan, idx) => {
        const open = expandedIdx === idx;
        return (
          <Card key={idx} className="border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedIdx(open ? null : idx)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${TAG_CLS[plan.tag]}`}
                >
                  {TAG_LABEL[plan.tag]}
                </span>
                <span className="font-semibold text-slate-800 text-sm font-noto-sans-sc">
                  {plan.structure}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs">
                <span className="tabular-nums text-slate-600">
                  命中率 {pct(plan.pCash)}
                </span>
                <span className={`tabular-nums font-medium ${evCls(plan.aggregateEV)}`}>
                  {evLabel(plan.aggregateEV)}
                </span>
                <span className="text-slate-400">{open ? "▾" : "▸"}</span>
              </div>
            </button>

            {open && (
              <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                {plan.note && (
                  <p className="text-xs text-slate-500 font-noto-sans-sc">{plan.note}</p>
                )}

                {/* Legs detail */}
                <div className="space-y-1.5">
                  {plan.legs.map((leg, li) => (
                    <div
                      key={leg.matchId + li}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs"
                    >
                      <div className="font-noto-sans-sc min-w-0">
                        <span className="text-slate-400 mr-1">腿{li + 1}</span>
                        <span className="font-medium text-slate-800">
                          {leg.homeName} vs {leg.awayName}
                        </span>
                        <span className="text-slate-600 ml-2">→ {leg.selectionLabel}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="tabular-nums text-slate-600">
                          {pct(leg.modelProb)}
                        </span>
                        <span className="tabular-nums text-slate-400">
                          × {leg.decimalOdds.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Metrics row */}
                <div className="flex flex-wrap gap-4 text-xs text-slate-500 border-t border-slate-100 pt-2">
                  <span>
                    票数 <strong className="text-slate-700">{plan.count}</strong>
                  </span>
                  <span>
                    过关概率 <strong className="text-slate-700">{pct(plan.pCash)}</strong>
                  </span>
                  <span className={evCls(plan.aggregateEV)}>
                    <strong>{evLabel(plan.aggregateEV)}</strong>
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">
                  以上为模型概率计算结果，仅供参考分析，不构成任何建议。实际结果受多因素影响。
                </p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default CombinationPanel;
