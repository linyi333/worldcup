import React, { useEffect, useState } from "react";
import { useLang } from "./lang";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WorldCupHeader } from "./components/WorldCupChrome";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/Tabs";
import { Card } from "./components/Card";
import { wcT } from "./i18n";
import { teamName } from "./teams";
import { beijingSlot, beijingTime, isBeijingLocal, localParts } from "./util";
import PredictionPanel from "./components/PredictionPanel";
import Flag from "./components/Flag";
import ScheduleControls, {
  EMPTY_FILTERS,
  type Filters,
} from "./components/ScheduleControls";
import type { Match, Prediction, MatchResult, LiveScore, WorldCupData } from "./types";

async function fetchWorldCup(): Promise<WorldCupData> {
  const res = await fetch("/api/worldcup/data");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Cache-first: ensures in-range matches are graded/predicted. Returns instantly
// if everything is already cached (no Claude call).
async function runRefresh() {
  const res = await fetch("/api/worldcup/refresh");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function matchFilter(m: Match, filters: Filters, lang: string): boolean {
  if (filters.stage && m.stage !== filters.stage) return false;
  if (filters.group && m.group !== filters.group) return false;
  if (filters.team && m.team1 !== filters.team && m.team2 !== filters.team) return false;
  if (filters.slot && beijingSlot(m.kickoffUtc) !== filters.slot) return false;
  if (filters.date) {
    const { dateKey } = localParts(m.kickoffUtc, lang);
    const key = dateKey === "tbd" ? `tbd-${m.date}` : dateKey;
    if (key !== filters.date) return false;
  }
  return true;
}

function groupByDate(fixtures: Match[], lang: string) {
  const buckets = new Map<string, { label: string; matches: Match[] }>();
  for (const m of fixtures) {
    const { dateKey, dateLabel } = localParts(m.kickoffUtc, lang);
    const key = dateKey === "tbd" ? `tbd-${m.date}` : dateKey;
    const label = dateLabel || m.date;
    if (!buckets.has(key)) buckets.set(key, { label, matches: [] });
    buckets.get(key)!.matches.push(m);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({
      ...v,
      matches: v.matches.sort((a, b) =>
        (a.kickoffUtc || a.date).localeCompare(b.kickoffUtc || b.date),
      ),
    }));
}

function MatchCard({
  match,
  prediction,
  result,
  live,
  lang,
}: {
  match: Match;
  prediction?: Prediction;
  result?: MatchResult;
  live?: LiveScore;
  lang: string;
}) {
  const { time } = localParts(match.kickoffUtc, lang);
  const bj = beijingTime(match.kickoffUtc, lang);
  const showBJ = lang === "zh" && !isBeijingLocal() && !!bj && bj !== time;
  const tag =
    match.stage === "group"
      ? match.group || wcT(lang, "group")
      : match.round || wcT(lang, "knockout");
  const finished = !!result;
  const isLive = !finished && !!live;
  // Time-derived status so cards differ by kickoff even when we have no score
  // (free data sources may lack live/result data). Score data, when present,
  // takes precedence over this.
  const kickoffMs = match.kickoffUtc ? new Date(match.kickoffUtc).getTime() : NaN;
  const LIVE_WINDOW_MS = 150 * 60 * 1000; // ~match length incl. half-time
  const now = Date.now();
  const timeStatus: "upcoming" | "live" | "ended" = Number.isNaN(kickoffMs)
    ? "upcoming"
    : now >= kickoffMs + LIVE_WINDOW_MS
      ? "ended"
      : now >= kickoffMs
        ? "live"
        : "upcoming";
  // "Ended but unscored": kickoff well past, yet no graded result/live score.
  const endedNoScore = !finished && !isLive && timeStatus === "ended";

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors hover:border-blue-300 hover:shadow-sm ${
        endedNoScore ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-[4.25rem] shrink-0 leading-tight">
            <div className="text-sm font-semibold tabular-nums text-slate-600">
              {time || "--:--"}
            </div>
            {showBJ && (
              <div className="text-[11px] tabular-nums text-slate-400">
                {wcT(lang, "beijingLabel")} {bj}
              </div>
            )}
          </div>
          <div className="min-w-0 font-noto-sans-sc">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                <Flag team={match.team1} />
                {teamName(match.team1, lang)}
              </span>
              <span className="text-xs text-slate-400">{wcT(lang, "vs")}</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                <Flag team={match.team2} />
                {teamName(match.team2, lang)}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-400">
              {tag}
              {match.ground ? ` · ${match.ground}` : ""}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {finished ? (
            <span className="text-lg font-bold tabular-nums text-slate-900">
              {result!.homeScore}–{result!.awayScore}
            </span>
          ) : isLive ? (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-lg font-bold tabular-nums text-red-600">
                {live!.homeScore}–{live!.awayScore}
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-600">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                {wcT(lang, "live")}
                {live!.minute ? ` ${live!.minute}'` : ""}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              {prediction && (
                <span
                  className={`text-sm font-medium ${
                    endedNoScore ? "text-slate-400" : "text-[#2A398D]"
                  }`}
                >
                  {wcT(lang, "aiPick")} {prediction.score}
                </span>
              )}
              {timeStatus === "live" && (
                <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  {wcT(lang, "live")}
                </span>
              )}
              {endedNoScore && (
                <span className="inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                  {wcT(lang, "ended")}
                </span>
              )}
            </div>
          )}
          {finished && prediction && result!.outcomeHit !== null && (
            <div className="mt-1">
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  result!.outcomeHit
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {result!.outcomeHit ? wcT(lang, "hit") : wcT(lang, "miss")}
              </span>
            </div>
          )}
        </div>
      </div>
      {!finished && prediction?.oneLiner && (
        <p className="mt-2 pl-[5rem] text-xs text-slate-500">{prediction.oneLiner}</p>
      )}
    </div>
  );
}

function HistoryRow({
  match,
  prediction,
  result,
  lang,
}: {
  match: Match;
  prediction: Prediction;
  result: MatchResult;
  lang: string;
}) {
  const { dateLabel } = localParts(match.kickoffUtc, lang);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-slate-400">{dateLabel}</div>
          <div className="flex flex-wrap items-center gap-x-2 font-noto-sans-sc font-medium text-slate-800">
            <span className="inline-flex items-center gap-1.5">
              <Flag team={match.team1} />
              {teamName(match.team1, lang)}
            </span>
            <span className="text-xs text-slate-400">{wcT(lang, "vs")}</span>
            <span className="inline-flex items-center gap-1.5">
              <Flag team={match.team2} />
              {teamName(match.team2, lang)}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right text-sm">
          <div className="text-slate-500">
            {wcT(lang, "predicted")}{" "}
            <span className="font-semibold text-[#2A398D]">{prediction.score}</span>
          </div>
          <div className="font-bold tabular-nums text-slate-900">
            {wcT(lang, "actual")} {result.homeScore}–{result.awayScore}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {result.outcomeHit !== null && (
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
              result.outcomeHit
                ? "bg-green-100 text-green-700"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            {result.outcomeHit ? `✓ ${wcT(lang, "hit")}` : `✗ ${wcT(lang, "miss")}`}
          </span>
        )}
        {result.exactHit && (
          <span className="inline-block rounded bg-[#2A398D]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#2A398D]">
            {wcT(lang, "exactHits")}
          </span>
        )}
      </div>
    </div>
  );
}

const WorldCupPage: React.FC = () => {
  const { lang } = useLang();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["worldcup-data"],
    queryFn: fetchWorldCup,
    staleTime: 5 * 60 * 1000,
  });

  // Trigger an on-demand, cache-first refresh once per mount; when it finishes,
  // re-pull the data so any newly-generated predictions/results show up.
  const refresh = useMutation({
    mutationFn: runRefresh,
    onSuccess: (res: { remaining?: number; newlyPredicted?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["worldcup-data"] });
      // Each call generates a few matches (timeout-bounded); keep going while
      // there's more to do AND the last call made progress (avoids a loop on
      // a persistently-failing match).
      if (res && (res.remaining ?? 0) > 0 && (res.newlyPredicted ?? 0) > 0) {
        refresh.mutate();
      }
    },
  });
  useEffect(() => {
    refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const fixtures = data?.fixtures ?? [];
  const filteredFixtures = fixtures.filter((m) => matchFilter(m, filters, lang));
  const dateGroups = groupByDate(filteredFixtures, lang);
  const acc = data?.meta?.accuracy;
  const hitRate =
    acc && acc.graded > 0 ? Math.round((acc.outcomeHits / acc.graded) * 100) : null;
  const predictedMatches = fixtures
    .filter((m) => data?.predictions?.[m.id])
    .sort((a, b) => (a.kickoffUtc || a.date).localeCompare(b.kickoffUtc || b.date));
  // Finished matches that we predicted — newest first.
  const gradedHistory = fixtures
    .filter((m) => data?.results?.[m.id] && data?.predictions?.[m.id])
    .sort((a, b) => (b.kickoffUtc || b.date).localeCompare(a.kickoffUtc || a.date));

  return (
    <div className="min-h-screen bg-slate-50">
      <WorldCupHeader />
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {data?.meta?.lastSyncAt && (
          <p className="text-xs text-muted-foreground">
            {wcT(lang, "lastSync")}:{" "}
            {new Date(data.meta.lastSyncAt).toLocaleString(
              lang === "en" ? "en-US" : "zh-CN",
            )}
          </p>
        )}

        {isLoading && <p className="mt-8 text-center">{wcT(lang, "loading")}</p>}
        {isError && (
          <p className="mt-8 text-center text-fengshui-red">{wcT(lang, "loadError")}</p>
        )}
        {!isLoading && !isError && fixtures.length === 0 && (
          <p className="mt-8 text-center text-muted-foreground">
            {wcT(lang, "syncing")}
          </p>
        )}

        {fixtures.length > 0 && (
          <Tabs defaultValue="schedule" className="mt-6">
            <TabsList>
              <TabsTrigger value="schedule">{wcT(lang, "tabSchedule")}</TabsTrigger>
              <TabsTrigger value="predictions">{wcT(lang, "tabPredictions")}</TabsTrigger>
              <TabsTrigger value="accuracy">{wcT(lang, "tabAccuracy")}</TabsTrigger>
            </TabsList>

            <TabsContent value="schedule" className="mt-4">
              <ScheduleControls
                fixtures={fixtures}
                lang={lang}
                filters={filters}
                setFilters={setFilters}
                count={filteredFixtures.length}
              />
              {dateGroups.length === 0 ? (
                <p className="mt-6 text-center text-muted-foreground">
                  {wcT(lang, "noMatch")}
                </p>
              ) : (
                <div className="space-y-6 mt-4">
                  {dateGroups.map((g, i) => (
                    <section key={i}>
                      <h2 className="font-noto-sans-sc font-semibold text-fengshui-darkgray mb-2">
                        {g.label}
                      </h2>
                      <div className="space-y-2">
                        {g.matches.map((m) => (
                          <MatchCard
                            key={m.id}
                            match={m}
                            prediction={data?.predictions?.[m.id]}
                            result={data?.results?.[m.id]}
                            live={data?.live?.[m.id]}
                            lang={lang}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="predictions" className="space-y-3 mt-4">
              {predictedMatches.length === 0 ? (
                <p className="text-muted-foreground">{wcT(lang, "noPredictions")}</p>
              ) : (
                predictedMatches.map((m) => (
                  <PredictionPanel
                    key={m.id}
                    match={m}
                    prediction={data!.predictions[m.id]}
                    value={data?.value?.[m.id]}
                    lang={lang}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="accuracy" className="space-y-4 mt-4">
              {/* Record summary */}
              <Card className="p-5 border-slate-200">
                <h2 className="font-noto-sans-sc font-semibold text-slate-700 mb-4">
                  {wcT(lang, "accuracyTitle")}
                </h2>
                {acc && acc.graded > 0 ? (
                  <>
                    {hitRate !== null && (
                      <div className="text-center mb-4">
                        <div className="text-4xl font-bold text-[#3CAC3B]">
                          {hitRate}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {wcT(lang, "hitRate")}
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold">{acc.graded}</div>
                        <div className="text-xs text-muted-foreground">
                          {wcT(lang, "graded")}
                        </div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{acc.outcomeHits}</div>
                        <div className="text-xs text-muted-foreground">
                          {wcT(lang, "outcomeHits")}
                        </div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold">{acc.exactHits}</div>
                        <div className="text-xs text-muted-foreground">
                          {wcT(lang, "exactHits")}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{wcT(lang, "noHistory")}</p>
                )}
              </Card>

              {/* Per-match history: prediction vs actual result */}
              {gradedHistory.length > 0 && (
                <div>
                  <h3 className="font-noto-sans-sc font-semibold text-slate-600 mb-2">
                    {wcT(lang, "historyTitle")}
                  </h3>
                  <div className="space-y-2">
                    {gradedHistory.map((m) => (
                      <HistoryRow
                        key={m.id}
                        match={m}
                        prediction={data!.predictions[m.id]}
                        result={data!.results[m.id]}
                        lang={lang}
                      />
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        <p className="mt-10 text-xs text-muted-foreground text-center">
          🎲 {wcT(lang, "disclaimer")}
        </p>
      </div>
    </div>
  );
};

export default WorldCupPage;
