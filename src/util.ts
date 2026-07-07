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

// Full stadium names for 2026 WC venues — openfootball only provides city/location.
const STADIUM_MAP: Record<string, { en: string; zh: string }> = {
  "Atlanta":                               { en: "Mercedes-Benz Stadium, Atlanta · USA",            zh: "梅赛德斯-奔驰体育场 · 亚特兰大，美国" },
  "Boston (Foxborough)":                   { en: "Gillette Stadium, Boston · USA",                  zh: "吉列体育场 · 波士顿，美国" },
  "Dallas (Arlington)":                    { en: "AT&T Stadium, Dallas · USA",                      zh: "AT&T体育场 · 达拉斯，美国" },
  "Guadalajara (Zapopan)":                { en: "Estadio Akron, Guadalajara · Mexico",              zh: "阿克朗球场 · 瓜达拉哈拉，墨西哥" },
  "Houston":                               { en: "NRG Stadium, Houston · USA",                      zh: "NRG体育场 · 休斯顿，美国" },
  "Kansas City":                           { en: "Arrowhead Stadium, Kansas City · USA",            zh: "箭头球场 · 堪萨斯城，美国" },
  "Los Angeles (Inglewood)":              { en: "SoFi Stadium, Los Angeles · USA",                  zh: "SoFi体育场 · 洛杉矶，美国" },
  "Mexico City":                           { en: "Estadio Azteca, Mexico City · Mexico",            zh: "阿兹特克球场 · 墨西哥城，墨西哥" },
  "Miami (Miami Gardens)":                { en: "Hard Rock Stadium, Miami · USA",                   zh: "硬石体育场 · 迈阿密，美国" },
  "Monterrey (Guadalupe)":                { en: "Estadio BBVA, Monterrey · Mexico",                 zh: "BBVA球场 · 蒙特雷，墨西哥" },
  "New York/New Jersey (East Rutherford)": { en: "MetLife Stadium, New York/New Jersey · USA",      zh: "大都会人寿球场 · 纽约/新泽西，美国" },
  "Philadelphia":                          { en: "Lincoln Financial Field, Philadelphia · USA",     zh: "林肯金融球场 · 费城，美国" },
  "San Francisco Bay Area (Santa Clara)":  { en: "Levi's Stadium, San Francisco Bay Area · USA",   zh: "李维斯球场 · 旧金山湾区，美国" },
  "Seattle":                               { en: "Lumen Field, Seattle · USA",                      zh: "流明球场 · 西雅图，美国" },
  "Toronto":                               { en: "BMO Field, Toronto · Canada",                     zh: "BMO球场 · 多伦多，加拿大" },
  "Vancouver":                             { en: "BC Place, Vancouver · Canada",                    zh: "BC广场球场 · 温哥华，加拿大" },
};

export function groundDisplay(ground: string, lang: string): string {
  if (!ground) return "";
  const entry = STADIUM_MAP[ground];
  if (!entry) return ground;
  return lang === "zh" ? entry.zh : entry.en;
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
