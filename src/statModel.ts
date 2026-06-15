import type { Match, MatchResult } from "./types";

// Professional-style statistical baseline: estimate each team's attack/defense
// strength from in-tournament goals (shrunk toward the league average for small
// samples), then a Poisson scoreline model → calibrated W/D/L, expected goals,
// most-likely score and over/under. Free, computed from results we already have;
// sharpens as the tournament accumulates games.

const CODED = /^(\d[A-Z]|[WL]\d+)$/i;
const PRIOR_GAMES = 2.5; // pseudo-games of shrinkage toward avg (short tournament → let real data count by GW2-3)
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
  const stat: Record<string, { gf: number; ga: number; g: number }> = {};
  let totalGoals = 0;
  let teamGames = 0;
  for (const f of fixtures) {
    const r = results[f.id];
    if (!r) continue;
    if (CODED.test(f.team1.trim()) || CODED.test(f.team2.trim())) continue;
    const rows: [string, number, number][] = [
      [f.team1, r.homeScore, r.awayScore],
      [f.team2, r.awayScore, r.homeScore],
    ];
    for (const [t, gf, ga] of rows) {
      const s = (stat[t] = stat[t] || { gf: 0, ga: 0, g: 0 });
      s.gf += gf;
      s.ga += ga;
      s.g += 1;
      totalGoals += gf;
      teamGames += 1;
    }
  }
  const leagueAvg = teamGames > 0 ? totalGoals / teamGames : 1.3; // goals per team per game

  function strength(t: string) {
    const s = stat[t];
    if (!s || s.g === 0) return { att: 1, def: 1, g: 0 };
    const att = (s.gf + PRIOR_GAMES * leagueAvg) / (s.g + PRIOR_GAMES) / leagueAvg;
    const def = (s.ga + PRIOR_GAMES * leagueAvg) / (s.g + PRIOR_GAMES) / leagueAvg;
    return { att, def, g: s.g };
  }

  function predict(f: Match): StatPrediction | null {
    if (CODED.test(f.team1.trim()) || CODED.test(f.team2.trim())) return null;
    const h = strength(f.team1);
    const a = strength(f.team2);
    if (h.g === 0 && a.g === 0) return null; // no data yet
    const expHome = Math.max(0.2, leagueAvg * h.att * a.def * HOME_ADV);
    const expAway = Math.max(0.2, (leagueAvg * a.att * h.def) / HOME_ADV);
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
