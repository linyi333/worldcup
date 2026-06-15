import React from "react";
import { Card } from "./Card";
import { Badge } from "./Badge";
import { wcT, wcConfidence } from "../i18n";
import { teamName } from "../teams";
import { beijingTime, isBeijingLocal, localParts } from "../util";
import Flag from "./Flag";
import type { Match, Prediction, ValueAnalysis, ValueVerdict } from "../types";
import type { StatPrediction } from "../statModel";

const VERDICT_STYLE: Record<ValueVerdict, { key: string; cls: string }> = {
  gap_high: { key: "valueVerdictGapHigh", cls: "bg-emerald-100 text-emerald-700" },
  gap: { key: "valueVerdictGap", cls: "bg-green-100 text-green-700" },
  fair: { key: "valueVerdictFair", cls: "bg-slate-100 text-slate-500" },
  market_high: { key: "valueVerdictMarketHigh", cls: "bg-amber-100 text-amber-700" },
};

// Model-vs-market panel. Descriptive comparison only — never a bet directive.
function ValuePanel({ value, match, lang }: { value: ValueAnalysis; match: Match; lang: string }) {
  const [showHelp, setShowHelp] = React.useState(false);
  const label = (l: "team1" | "draw" | "team2") =>
    l === "draw" ? wcT(lang, "valueDraw") : teamName(l === "team1" ? match.team1 : match.team2, lang);

  // Plain one-line takeaway: the outcome (if any) the model is most bullish on
  // vs the market, otherwise "broadly aligned".
  const gap = value.outcomes
    .filter((o) => o.verdict === "gap" || o.verdict === "gap_high")
    .sort((a, b) => b.edgeRatio - a.edgeRatio)[0];
  const summary = !gap
    ? wcT(lang, "valueSummaryNone")
    : lang === "en"
      ? `Model is more bullish on ${label(gap.label)} than the market (${gap.modelProb}% vs ${gap.impliedProb}%).`
      : `模型在【${label(gap.label)}】上比市场更乐观(模型 ${gap.modelProb}% vs 市场 ${gap.impliedProb}%)。`;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{wcT(lang, "valueTitle")}</span>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="text-[11px] text-[#2A398D] underline-offset-2 hover:underline"
          >
            {wcT(lang, "valueHelpToggle")}
          </button>
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">
          {wcT(lang, "valueAsOf")} {new Date(value.capturedAt).toLocaleString(lang === "en" ? "en-US" : "zh-CN")}
        </span>
      </div>
      <p className="mb-2 text-xs text-slate-500">{wcT(lang, "valueSubtitle")}</p>

      {showHelp && (
        <p className="mb-2 rounded border border-slate-200 bg-white p-2 text-[11px] leading-relaxed text-slate-500">
          {wcT(lang, "valueHelpBody")}
        </p>
      )}

      <p className="mb-2 text-xs font-medium text-slate-700">{summary}</p>

      <div className="space-y-1.5">
        {value.outcomes.map((o) => {
          const v = VERDICT_STYLE[o.verdict];
          return (
            <div key={o.label} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{label(o.label)}</span>
              <span className="tabular-nums text-slate-500">
                {wcT(lang, "valueModel")} {o.modelProb}% · {wcT(lang, "valueMarket")} {o.impliedProb}%
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${v.cls}`}>
                {wcT(lang, v.key as any)}
              </span>
            </div>
          );
        })}
      </div>
      {(value.handicap || value.totals) && (
        <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
          {value.handicap && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
              <span className="shrink-0 font-medium text-slate-700">
                {wcT(lang, "valueHandicap")}{" "}
                <span className="text-slate-400">
                  {teamName(match.team1, lang)} {value.handicap.line > 0 ? "+" : ""}
                  {value.handicap.line}
                </span>
              </span>
              <span className="tabular-nums text-slate-500">
                {teamName(match.team1, lang)} {value.handicap.homeProb}% ·{" "}
                {teamName(match.team2, lang)} {value.handicap.awayProb}%
              </span>
              {value.handicap.modelHome !== null && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                  {wcT(lang, "valueModelLean")}{" "}
                  {teamName(value.handicap.modelHome ? match.team1 : match.team2, lang)}
                </span>
              )}
            </div>
          )}
          {value.totals && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
              <span className="shrink-0 font-medium text-slate-700">
                {wcT(lang, "valueTotals")} <span className="text-slate-400">{value.totals.line}</span>
              </span>
              <span className="tabular-nums text-slate-500">
                {wcT(lang, "valueOver")} {value.totals.overProb}% · {wcT(lang, "valueUnder")}{" "}
                {value.totals.underProb}%
              </span>
              {value.totals.modelOver !== null && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                  {wcT(lang, "valueModelLean")}{" "}
                  {value.totals.modelOver ? wcT(lang, "valueOver") : wcT(lang, "valueUnder")}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] leading-snug text-slate-400">{wcT(lang, "valueDisclaimer")}</p>
    </div>
  );
}

function ProbBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded">
      <div className="bg-[#3CAC3B]" style={{ width: `${home}%` }} />
      <div className="bg-amber-400" style={{ width: `${draw}%` }} />
      <div className="bg-[#2A398D]" style={{ width: `${away}%` }} />
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold">{label}: </span>
      <span className="text-muted-foreground">{value}</span>
    </p>
  );
}

const PredictionPanel: React.FC<{
  match: Match;
  prediction: Prediction;
  value?: ValueAnalysis;
  stat?: StatPrediction | null;
  lang: string;
}> = ({ match, prediction, value, stat, lang }) => {
  const { dateLabel, time } = localParts(match.kickoffUtc, lang);
  const bj = beijingTime(match.kickoffUtc, lang);
  const showBJ = lang === "zh" && !isBeijingLocal() && !!bj && bj !== time;
  const d = prediction.detail || {};
  const f = d.factors || {};
  const wp = prediction.winProb;
  // Predictions are generated in Chinese; on the EN page we hide the zh prose
  // and keep only the language-neutral numbers (scores, %, value/handicap).
  const isEn = lang === "en";

  return (
    <Card className="p-4 border-slate-200">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            {match.group || match.round} · {dateLabel} {time}
            {showBJ ? ` · ${wcT(lang, "beijingLabel")} ${bj}` : ""}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 font-noto-sans-sc text-lg font-medium text-slate-800">
            <span className="inline-flex items-center gap-1.5">
              <Flag team={match.team1} />
              {teamName(match.team1, lang)}
            </span>
            <span className="text-sm text-slate-400">{wcT(lang, "vs")}</span>
            <span className="inline-flex items-center gap-1.5">
              <Flag team={match.team2} />
              {teamName(match.team2, lang)}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[#2A398D]">{prediction.score}</div>
          <Badge variant="secondary" className="font-normal">
            {wcT(lang, "confidence")}: {wcConfidence(lang, prediction.confidence)}
          </Badge>
        </div>
      </div>

      <div className="mt-3">
        <ProbBar {...wp} />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{teamName(match.team1, lang)} {wcT(lang, "win")} {wp.home}%</span>
          <span>{wcT(lang, "drawProb")} {wp.draw}%</span>
          <span>{teamName(match.team2, lang)} {wcT(lang, "win")} {wp.away}%</span>
        </div>
      </div>

      {prediction.oneLiner && !isEn && (
        <p className="mt-3 text-sm">{prediction.oneLiner}</p>
      )}

      {value && value.outcomes.length > 0 && (
        <ValuePanel value={value} match={match} lang={lang} />
      )}

      {stat && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">{wcT(lang, "statTitle")}</span>
            <span className="text-[11px] text-slate-400">
              {wcT(lang, "statSample")}: {stat.basedOn} {wcT(lang, "statSampleUnit")}
            </span>
          </div>
          <ProbBar home={stat.homeWin} draw={stat.draw} away={stat.awayWin} />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{teamName(match.team1, lang)} {stat.homeWin}%</span>
            <span>{wcT(lang, "drawProb")} {stat.draw}%</span>
            <span>{teamName(match.team2, lang)} {stat.awayWin}%</span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            {wcT(lang, "statExpected")}: <span className="font-semibold">{stat.likelyScore}</span>{" "}
            <span className="text-slate-400">
              (xG {stat.expHome}–{stat.expAway} · {wcT(lang, "overUnder")} {stat.over25}%)
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-400">{wcT(lang, "statNote")}</p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        {d.prediction?.over_under_2_5 && (
          <span>{wcT(lang, "overUnder")}: {d.prediction.over_under_2_5}</span>
        )}
        {d.prediction?.first_goal_window && !isEn && (
          <span>{wcT(lang, "firstGoal")}: {d.prediction.first_goal_window}</span>
        )}
      </div>

      {!isEn && (
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-[#2A398D]">
          {wcT(lang, "details")}
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <h4 className="font-semibold text-sm mb-1">{wcT(lang, "factors")}</h4>
            <div className="space-y-1">
              <Row label={wcT(lang, "fData")} value={f.data?.summary} />
              <Row
                label={wcT(lang, "fHome")}
                value={[f.home_advantage?.crowd, f.home_advantage?.travel, f.home_advantage?.climate_altitude, f.home_advantage?.referee]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Row label={wcT(lang, "fHistory")} value={[f.history?.h2h, f.history?.patterns].filter(Boolean).join(" · ")} />
              <Row label={wcT(lang, "fWeather")} value={[f.weather?.conditions, f.weather?.impact].filter(Boolean).join(" · ")} />
              <Row label={wcT(lang, "fPolitics")} value={f.politics?.summary} />
              <Row label={wcT(lang, "fTactics")} value={[f.tactics?.matchup, f.tactics?.key_battle].filter(Boolean).join(" · ")} />
              <Row label={wcT(lang, "fMeta")} value={f.metaphysics?.fun_fact} />
            </div>
          </div>
          <Row label={wcT(lang, "gameScript")} value={d.game_script} />
          <Row label={wcT(lang, "biggestRisk")} value={d.biggest_risk} />
          {d.key_players && d.key_players.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-1">{wcT(lang, "keyPlayers")}</h4>
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {d.key_players.map((p, i) => (
                  <li key={i}>
                    {p.name}
                    {p.team ? ` (${p.team})` : ""} — {p.why}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
      )}
    </Card>
  );
};

export default PredictionPanel;
