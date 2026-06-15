import React, { useState } from "react";
import { wcT } from "../i18n";
import { teamName } from "../teams";
import { localParts, SLOTS, type Slot } from "../util";
import type { Match } from "../types";

export interface Filters {
  date: string;
  group: string;
  stage: string;
  team: string;
  slot: string;
}

export const EMPTY_FILTERS: Filters = {
  date: "",
  group: "",
  stage: "",
  team: "",
  slot: "",
};

const SLOT_KEY: Record<Slot, "slotLate" | "slotMorning" | "slotAfternoon" | "slotEvening"> = {
  late: "slotLate",
  morning: "slotMorning",
  afternoon: "slotAfternoon",
  evening: "slotEvening",
};

const CODED_TEAM = /^(\d[A-Z]|[WL]\d+)$/i;

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

const selectCls =
  "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500";

const ScheduleControls: React.FC<{
  fixtures: Match[];
  lang: string;
  filters: Filters;
  setFilters: (f: Filters) => void;
  count: number;
}> = ({ fixtures, lang, filters, setFilters, count }) => {
  const all = wcT(lang, "filterAll");

  // Date options (browser-local), keyed for sorting, labelled for display
  const dateMap = new Map<string, string>();
  for (const m of fixtures) {
    const { dateKey, dateLabel } = localParts(m.kickoffUtc, lang);
    const key = dateKey === "tbd" ? `tbd-${m.date}` : dateKey;
    if (!dateMap.has(key)) dateMap.set(key, dateLabel || m.date);
  }
  const dates = Array.from(dateMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  const groups = uniqueSorted(fixtures.map((m) => m.group || ""));
  const teams = uniqueSorted(
    fixtures.flatMap((m) => [m.team1, m.team2]).filter((t) => !CODED_TEAM.test(t.trim())),
  ).sort((a, b) => teamName(a, lang).localeCompare(teamName(b, lang), lang === "zh" ? "zh" : "en"));

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const isFiltered = !!(
    filters.date ||
    filters.group ||
    filters.stage ||
    filters.team ||
    filters.slot
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-slate-50/95 backdrop-blur border-b border-slate-200">
      {/* Mobile: collapse the dropdowns behind a toggle (desktop shows them inline) */}
      <div className="flex items-center justify-between sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700"
        >
          {wcT(lang, "filterToggle")}
          {isFiltered && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
          <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        </button>
        <span className="text-sm text-muted-foreground">
          {count} {wcT(lang, "matchesUnit")}
        </span>
      </div>

      <div
        className={`${open ? "mt-2 flex" : "hidden"} flex-wrap items-center gap-2 sm:mt-0 sm:flex`}
      >
        <select
          className={selectCls}
          value={filters.date}
          onChange={(e) => set({ date: e.target.value })}
        >
          <option value="">{wcT(lang, "filterDate")} · {all}</option>
          {dates.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={filters.slot}
          onChange={(e) => set({ slot: e.target.value })}
        >
          <option value="">{wcT(lang, "filterTime")} · {all}</option>
          {SLOTS.map((s) => (
            <option key={s} value={s}>
              {wcT(lang, SLOT_KEY[s])}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={filters.stage}
          onChange={(e) => set({ stage: e.target.value })}
        >
          <option value="">{wcT(lang, "filterStage")} · {all}</option>
          <option value="group">{wcT(lang, "group")}</option>
          <option value="knockout">{wcT(lang, "knockout")}</option>
        </select>

        <select
          className={selectCls}
          value={filters.group}
          onChange={(e) => set({ group: e.target.value })}
        >
          <option value="">{wcT(lang, "filterGroup")} · {all}</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={filters.team}
          onChange={(e) => set({ team: e.target.value })}
        >
          <option value="">{wcT(lang, "filterTeam")} · {all}</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {teamName(t, lang)}
            </option>
          ))}
        </select>

        <span className="ml-1 hidden text-sm text-muted-foreground sm:inline">
          {count} {wcT(lang, "matchesUnit")}
        </span>

        {isFiltered && (
          <button
            className="text-sm text-blue-700 underline ml-auto"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            {wcT(lang, "reset")}
          </button>
        )}
      </div>
    </div>
  );
};

export default ScheduleControls;
