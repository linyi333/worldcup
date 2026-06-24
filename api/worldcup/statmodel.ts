import type { Match, MatchResult } from "./types.js";

// Professional-style statistical baseline: estimate each team's attack/defense
// strength from in-tournament goals (shrunk toward the league average for small
// samples), then a Poisson scoreline model → calibrated W/D/L, expected goals,
// most-likely score and over/under. Free, computed from results we already have;
// sharpens as the tournament accumulates games.

const CODED = /^(\d[A-Z]|[WL]\d+)$/i;
const PRIOR_GAMES = 2.0; // pseudo-games of shrinkage; 2.0 lets 3 real games contribute 60% weight
const FIFA_SCALE = 800; // larger = FIFA points spread teams less

// FIFA Men's World Ranking points snapshot (pre-WC 2026). Rankings don't change
// during a tournament, so a static table is fine — free, no API. Keyed by the
// normalized team name. Used as the stat model's pre-tournament strength prior.
const FIFA_POINTS: Record<string, number> = {
  argentina: 1877, spain: 1875, france: 1871, england: 1828, portugal: 1768,
  brazil: 1765, morocco: 1756, netherlands: 1749, germany: 1744, belgium: 1742,
  croatia: 1715, mexico: 1701, colombia: 1698, usa: 1689, senegal: 1684,
  uruguay: 1673, japan: 1666, switzerland: 1641, iran: 1620, korea: 1613,
  australia: 1606, ecuador: 1599, austria: 1597, turkey: 1579, algeria: 1571,
  egypt: 1562, norway: 1557, cotedivoire: 1541, panama: 1539, canada: 1535,
  scotland: 1519, sweden: 1510, paraguay: 1488, czechia: 1485, tunisia: 1476,
  democraticrepublicofthecongo: 1474, qatar: 1459, uzbekistan: 1458, iraq: 1446,
  southafrica: 1428, saudiarabia: 1423, jordan: 1387, bosniaandherzegovina: 1387,
  caboverde: 1371, ghana: 1346, curacao: 1294, haiti: 1293, newzealand: 1275,
};
const FIFA_ALIASES: Record<string, string> = {
  southkorea: "korea", korearepublic: "korea", unitedstates: "usa", us: "usa",
  czechrepublic: "czechia", ivorycoast: "cotedivoire", iranislamicrepublic: "iran",
  capeverde: "caboverde", turkiye: "turkey", drcongo: "democraticrepublicofthecongo",
};
function normTeam(s: string): string {
  const b = String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z]/g, "");
  return FIFA_ALIASES[b] || b;
}

// Squad modernization factor: adjusts the FIFA prior for teams whose players
// play at significantly higher (or lower) club levels than their ranking implies.
// FIFA rankings are 4-year averages and lag behind squad evolution. Pre-tournament
// snapshot — only teams with a notable gap from their ranking are listed.
// >1.0 = underrated by FIFA rank, <1.0 = overrated.
const SQUAD_TIER: Record<string, number> = {
  // Underrated — deep European top-league presence
  morocco:       1.08, // Hakimi (PSG), Mazraoui (Bayern), Ziyech, etc.
  japan:         1.07, // Endo (Liverpool), Mitoma (Brighton), 8+ Bundesliga starters
  senegal:       1.06, // strong PL + Ligue1 base
  cotedivoire:   1.05, // Kessié, Zaha, etc. — PL/Ligue1 heavy
  usa:           1.04, // Pulisic (AC Milan), Reyna, Weah — growing European base
  canada:        1.04, // Davies (Bayern), Johnston, Larin, etc.
  australia:     1.03, // Hrustic, Leckie, Rowles in Europe
  cameroon:      1.03, // Onana (Man Utd), Choupo-Moting, Toko Ekambi
  ecuador:       1.03, // Caicedo (Chelsea), Estupiñán (Brighton)
  ghana:         1.02, // Kudus (West Ham), Salisu (Southampton)

  // Overrated — primarily domestic or lower-tier leagues
  saudiarabia:   0.94, // Saudi Pro League dominant; Ronaldo/Benzema imports skew results
  qatar:         0.91, // Qatar Stars League almost entirely
  uzbekistan:    0.93, // Central Asian leagues
  iraq:          0.93, // Iraqi/Gulf leagues
  jordan:        0.92, // Jordan + Gulf leagues
  newzealand:    0.94, // A-League base
  curacao:       0.93, // mostly MLS/Caribbean
  haiti:         0.95, // Haitian diaspora + lower European leagues
};

const FIFA_VALUES = Object.values(FIFA_POINTS);
const FIFA_MEAN = FIFA_VALUES.reduce((a, b) => a + b, 0) / (FIFA_VALUES.length || 1);

// Strength multiplier: FIFA ranking + squad club-tier adjustment.
function fifaFactor(team: string): number {
  const key = normTeam(team);
  const p = FIFA_POINTS[key] ?? FIFA_MEAN;
  const tier = SQUAD_TIER[key] ?? 1.0;
  return Math.exp((p - FIFA_MEAN) / FIFA_SCALE) * tier;
}
const HOME_ADV = 1.05; // mild nudge for the nominal home side (mostly neutral venues)
const MAX_GOALS = 8;
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880];

export interface StatPrediction {
  homeWin: number; // %
  draw: number;
  awayWin: number;
  expHome: number; // expected goals
  expAway: number;
  likelyScore: string;
  over25: number; // % of 3+ total goals
  basedOn: number; // fewer of the two teams' games played (confidence hint)
}

function poisson(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / (FACT[k] ?? 1);
}

export function buildStatModel(
  fixtures: Match[],
  results: Record<string, MatchResult>,
) {
  // gfW / gaW: opponent-quality-weighted goals.
  // Scoring vs a strong opponent counts more for attack; conceding to a weak
  // opponent counts more for defense. fifaFactor(opponent) is the weight.
  const stat: Record<string, { gfW: number; gaW: number; g: number }> = {};
  let groupGoals = 0, groupGames = 0;
  let knockoutGoals = 0, knockoutGames = 0;
  for (const f of fixtures) {
    const r = results[f.id];
    if (!r) continue;
    if (CODED.test(f.team1.trim()) || CODED.test(f.team2.trim())) continue;
    const oppF1 = fifaFactor(f.team2); // quality of team1's opponent
    const oppF2 = fifaFactor(f.team1); // quality of team2's opponent
    const rows: [string, number, number, number][] = [
      [f.team1, r.homeScore, r.awayScore, oppF1],
      [f.team2, r.awayScore, r.homeScore, oppF2],
    ];
    for (const [t, gf, ga, oppF] of rows) {
      const s = (stat[t] = stat[t] || { gfW: 0, gaW: 0, g: 0 });
      s.gfW += gf * oppF;   // scoring vs strong team counts more
      s.gaW += ga / oppF;   // conceding to weak team counts more (worse)
      s.g += 1;
      if (f.stage === "group") { groupGoals += gf; groupGames += 1; }
      else { knockoutGoals += gf; knockoutGames += 1; }
    }
  }
  // Group and knockout stages have different scoring dynamics. Knockout rounds
  // average ~15% fewer goals historically (teams conserve energy, protect leads,
  // avoid overcommitting). Use stage-specific averages; fall back to ×0.85 of
  // the group average until at least 4 knockout results are in.
  // Default 1.5: 2026 WC has 48 teams → more mismatches → higher scoring than
  // a typical 32-team tournament. Historical 32-team WC averaged ~1.35/team/game;
  // 2026 group stage is tracking higher. Real data overrides this immediately.
  const groupAvg = groupGames > 0 ? groupGoals / groupGames : 1.5;
  const KNOCKOUT_FACTOR = 0.85; // historical World Cup fallback
  const knockoutAvg =
    knockoutGames >= 4
      ? knockoutGoals / knockoutGames
      : groupAvg * KNOCKOUT_FACTOR;
  const leagueAvg = groupAvg; // used for team strength calculations (group-stage baseline)

  function strength(t: string) {
    const s = stat[t] || { gfW: 0, gaW: 0, g: 0 };
    // Pre-tournament prior from FIFA points: strong teams score more / concede
    // less. In-tournament goals (opponent-adjusted) pull toward actual form.
    const f = fifaFactor(t);
    const attPrior = leagueAvg * f;
    const defPrior = leagueAvg / f;
    const att = (s.gfW + PRIOR_GAMES * attPrior) / (s.g + PRIOR_GAMES) / leagueAvg;
    const def = (s.gaW + PRIOR_GAMES * defPrior) / (s.g + PRIOR_GAMES) / leagueAvg;
    return { att, def, g: s.g };
  }

  function predict(f: Match): StatPrediction | null {
    if (CODED.test(f.team1.trim()) || CODED.test(f.team2.trim())) return null;
    const h = strength(f.team1);
    const a = strength(f.team2);
    // Knockout rounds are tactically more conservative — use the lower stage avg.
    const stageAvg = f.stage === "knockout" ? knockoutAvg : groupAvg;
    const expHome = Math.max(0.2, stageAvg * h.att * a.def * HOME_ADV);
    const expAway = Math.max(0.2, (stageAvg * a.att * h.def) / HOME_ADV);
    const ph: number[] = [];
    const pa: number[] = [];
    for (let k = 0; k <= MAX_GOALS; k++) {
      ph[k] = poisson(expHome, k);
      pa[k] = poisson(expAway, k);
    }
    let hw = 0;
    let dr = 0;
    let aw = 0;
    let over = 0;
    let best = -1;
    let bi = 0;
    let bj = 0;
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = ph[i] * pa[j];
        if (i > j) hw += p;
        else if (i === j) dr += p;
        else aw += p;
        if (i + j > 2) over += p;
        if (p > best) {
          best = p;
          bi = i;
          bj = j;
        }
      }
    }
    const tot = hw + dr + aw || 1;
    return {
      homeWin: Math.round((hw / tot) * 100),
      draw: Math.round((dr / tot) * 100),
      awayWin: Math.round((aw / tot) * 100),
      expHome: Math.round(expHome * 10) / 10,
      expAway: Math.round(expAway * 10) / 10,
      likelyScore: `${bi}-${bj}`,
      over25: Math.round(over * 100),
      basedOn: Math.min(h.g, a.g),
    };
  }

  return { predict, leagueAvg };
}
