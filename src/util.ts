const BEIJING = "Asia/Shanghai";

function locale(lang: string): string {
  return lang === "en" ? "en-US" : "zh-CN";
}

// Date/time in the BROWSER'S local timezone (most intuitive "what time for me").
export function localParts(iso: string | null, lang: string) {
  if (!iso) return { dateKey: "tbd", dateLabel: "", time: "" };
  const d = new Date(iso);
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // local date
  const dateLabel = new Intl.DateTimeFormat(locale(lang), {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat(locale(lang), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return { dateKey, dateLabel, time };
}

// Kickoff time in Beijing (China Standard Time).
export function beijingTime(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: BEIJING,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Is the browser already on Beijing time? (then don't show it twice)
export function isBeijingLocal(): boolean {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === BEIJING;
  } catch {
    return false;
  }
}

// Coarse time-of-day slot by Beijing time — most NA matches land in the small
// hours for Chinese viewers, so a few broad buckets are more useful than hours.
export type Slot = "late" | "morning" | "afternoon" | "evening";
export const SLOTS: Slot[] = ["late", "morning", "afternoon", "evening"];

export function beijingSlot(iso: string | null): Slot | null {
  if (!iso) return null;
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone: BEIJING,
    hour: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  const h = Number(raw) % 24;
  if (Number.isNaN(h)) return null;
  if (h < 6) return "late";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
