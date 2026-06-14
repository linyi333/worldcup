import { norm } from "./grade.js";
import { getWc26Games, type Wc26Game } from "./wc26.js";
import type { Match, MatchResult } from "./types.js";

// Build a "form in THIS tournament" summary for the two teams in an upcoming
// match — their completed games (result, goals, scorers). This is far more
// predictive than pre-tournament priors once teams have played, and it's free
// (we already have results; scorers come from the worldcup26 feed).

function findGame(games: Wc26Game[], f: Match): Wc26Game | null {
  const t1 = norm(f.team1);
  const t2 = norm(f.team2);
  return (
    games.find((g) => {
      const h = norm(g.home);
      const a = norm(g.away);
      return (h === t1 && a === t2) || (h === t2 && a === t1);
    }) ?? null
  );
}

// One team's completed games, newest first, from its own perspective.
function teamLines(
  team: string,
  upcomingId: string,
  fixtures: Match[],
  results: Record<string, MatchResult>,
  games: Wc26Game[],
): string[] {
  const nt = norm(team);
  const played = fixtures
    .filter((f) => {
      if (f.id === upcomingId || !results[f.id]) return false;
      return norm(f.team1) === nt || norm(f.team2) === nt;
    })
    .sort((a, b) => (b.kickoffUtc || b.date).localeCompare(a.kickoffUtc || a.date));

  return played.map((f) => {
    const r = results[f.id];
    const isHome = norm(f.team1) === nt;
    const gf = isHome ? r.homeScore : r.awayScore;
    const ga = isHome ? r.awayScore : r.homeScore;
    const opp = isHome ? f.team2 : f.team1;
    const res = gf > ga ? "W" : gf < ga ? "L" : "D";
    // Scorers for THIS team from the feed, if available.
    const g = findGame(games, f);
    let scorers = "";
    if (g) {
      const teamIsFeedHome = norm(g.home) === nt;
      const s = teamIsFeedHome ? g.homeScorers : g.awayScorers;
      if (s) scorers = ` [${s}]`;
    }
    return `${res} ${gf}-${ga} vs ${opp}${scorers}`;
  });
}

export async function buildTeamForm(
  match: Match,
  fixtures: Match[],
  results: Record<string, MatchResult>,
): Promise<string> {
  let games: Wc26Game[] = [];
  try {
    games = await getWc26Games();
  } catch {
    /* scorers optional */
  }
  const blocks: string[] = [];
  for (const team of [match.team1, match.team2]) {
    const lines = teamLines(team, match.id, fixtures, results, games);
    if (lines.length) blocks.push(`${team} so far: ${lines.join(" | ")}`);
  }
  return blocks.join("\n");
}
