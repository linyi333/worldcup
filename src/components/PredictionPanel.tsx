import React from "react";
import { Card } from "./Card";
import { Badge } from "./Badge";
import { wcT } from "../i18n";
import { teamName } from "../teams";
import { beijingTime, isBeijingLocal, localParts } from "../util";
import Flag from "./Flag";
import type { Match, Prediction } from "../types";

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
  lang: string;
}> = ({ match, prediction, lang }) => {
  const { dateLabel, time } = localParts(match.kickoffUtc, lang);
  const bj = beijingTime(match.kickoffUtc, lang);
  const showBJ = lang === "zh" && !isBeijingLocal() && !!bj && bj !== time;
  const d = prediction.detail || {};
  const f = d.factors || {};
  const wp = prediction.winProb;

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
            {wcT(lang, "confidence")}: {prediction.confidence}
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

      {prediction.oneLiner && <p className="mt-3 text-sm">{prediction.oneLiner}</p>}

      <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        {d.prediction?.over_under_2_5 && (
          <span>{wcT(lang, "overUnder")}: {d.prediction.over_under_2_5}</span>
        )}
        {d.prediction?.first_goal_window && (
          <span>{wcT(lang, "firstGoal")}: {d.prediction.first_goal_window}</span>
        )}
      </div>

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
    </Card>
  );
};

export default PredictionPanel;
