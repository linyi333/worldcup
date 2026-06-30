import { methodNotAllowed, sendJson, serverError } from "../_lib/http.js";
import { fetchFixtures, fetchResults, fetchScoreViaWebSearch } from "./sources.js";
import { applyGrade, findResult } from "./grade.js";
import { getClosingLines } from "./odds.js";
import { buildTeamForm } from "./form.js";
import { buildStatModel } from "./statmodel.js";
import type { MarketProbs } from "./odds.js";
import { predictMatch } from "./predict.js";
import {
  getPredictions,
  getResults,
  setFixtures,
  setMeta,
  setPrediction,
  setResult,
} from "./store.js";
import type { Match, MatchResult, Prediction, WorldCupMeta } from "./types.js";

// Opus predictions take ~30-50s each; default Vercel timeout is 10s, so raise it.
// Hobby max is 60s (Pro allows up to 300s — raise WORLDCUP_MAX_PREDICTIONS there).
export const maxDuration = 60;

// On-demand refresh (no cron). The page calls this; it is CACHE-FIRST:
//   - predictions already in Redis for day-range matches are reused (no Claude)
//   - only uncached in-range matches are generated (capped per call)
//   - finished matches are graded (free) and accuracy recomputed
// Cost is bounded by the cache: once a match is predicted it's never re-billed.

const CODED_TEAM = /^(\d[A-Z]|[WL]\d+)$/i;

function kickoffMs(m: Match): number | null {
  return m.kickoffUtc ? new Date(m.kickoffUtc).getTime() : null;
}

// PST calendar date (YYYY-MM-DD) — the tournament's host-time "matchday".
function pstDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

// Hour of day (0–23) in California time.
function pstHour(ms: number): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  return parseInt(h, 10) % 24; // midnight can format as "24"
}

function buildRecentContext(
  fixtures: Match[],
  results: Record<string, MatchResult>,
): string {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  return Object.values(results)
    .sort((a, b) => a.gradedAt.localeCompare(b.gradedAt))
    .slice(-10)
    .map((r) => {
      const f = byId.get(r.matchId);
      return f ? `${f.team1} ${r.homeScore}-${r.awayScore} ${f.team2}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

// Detect each team's qualification status from current group standings.
// Returns a prompt-ready string (or null for knockout matches).
function buildGroupContext(
  match: Match,
  fixtures: Match[],
  results: Record<string, MatchResult>,
): string | null {
  if (!match.group || match.stage !== "group") return null;

  const gf = fixtures.filter((f) => f.group === match.group && f.stage === "group");
  const rows: Record<string, { pts: number; w: number; d: number; l: number; gf: number; ga: number; played: number }> = {};

  for (const f of gf) {
    for (const t of [f.team1, f.team2]) {
      rows[t] = rows[t] || { pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, played: 0 };
    }
    const r = results[f.id];
    if (!r) continue;
    const h = rows[f.team1], a = rows[f.team2];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += r.homeScore; h.ga += r.awayScore;
    a.gf += r.awayScore; a.ga += r.homeScore;
    if (r.homeScore > r.awayScore) { h.pts += 3; h.w++; a.l++; }
    else if (r.homeScore < r.awayScore) { a.pts += 3; a.w++; h.l++; }
    else { h.pts++; a.pts++; h.d++; a.d++; }
  }

  const TOTAL_GROUP_GAMES = 3; // each team plays 3 group games
  const sorted = Object.entries(rows)
    .map(([team, r]) => ({ team, ...r, gLeft: TOTAL_GROUP_GAMES - r.played }))
    .sort((a, b) => (b.pts - a.pts) || (b.gf - b.ga - a.gf + a.ga));

  // Max pts any team can still reach
  const maxReachable = sorted.map((r) => r.pts + r.gLeft * 3);

  // A team is locked into top-2 if even the 3rd-place team's max can't overtake them
  // A team is eliminated if their max pts < the current 2nd-place pts
  const qualLines = sorted.map((r, i) => {
    const thirdMax = maxReachable[2] ?? 0;
    const secondCurrent = sorted[1]?.pts ?? 0;
    const myMax = r.pts + r.gLeft * 3;

    let status: string;
    if (r.gLeft === 0 && i < 2) {
      status = "QUALIFIED ✓";
    } else if (r.pts > thirdMax) {
      status = "QUALIFIED ✓ (locked top-2)";
    } else if (myMax < secondCurrent) {
      status = "ELIMINATED ✗";
    } else if (r.gLeft === 0 && i >= 2) {
      status = "eliminated ✗";
    } else {
      status = `${r.gLeft} game(s) left`;
    }

    const gd = r.gf - r.ga;
    return `  ${i + 1}. ${r.team}: ${r.pts}pts (${r.w}W${r.d}D${r.l}L GD${gd > 0 ? "+" : ""}${gd}) — ${status}`;
  });

  // Strategic flag: check the two teams playing this match
  const t1 = sorted.find((r) => r.team === match.team1);
  const t2 = sorted.find((r) => r.team === match.team2);

  const isQualified = (r: (typeof sorted)[0]) => {
    const thirdMax = maxReachable[2] ?? 0;
    return r.pts > thirdMax || (r.gLeft === 0 && sorted.indexOf(r) < 2);
  };
  const isEliminated = (r: (typeof sorted)[0]) =>
    r.pts + r.gLeft * 3 < (sorted[1]?.pts ?? 0);

  // What does each team need from this specific match?
  // Compares their pts after win/draw/loss against the current 2nd-place bar.
  // Returns a human-readable stakes line, or null if already settled.
  function teamStake(r: (typeof sorted)[0]): string | null {
    if (isQualified(r)) return `${r.team}: already qualified — result irrelevant for advancement`;
    if (isEliminated(r)) return `${r.team}: already eliminated — no pressure`;

    const secondPts = sorted[1]?.pts ?? 0; // current threshold to be in top 2
    const idx = sorted.indexOf(r);

    const ptsWin  = r.pts + 3;
    const ptsDraw = r.pts + 1;
    // ptsLoss = r.pts (no change)

    // Currently 3rd or 4th — needs to climb
    if (idx >= 2) {
      if (ptsDraw > secondPts) {
        // Draw overtakes current 2nd → draw is likely enough
        return `${r.team}: a draw may be enough to advance (${ptsDraw} pts would overtake current 2nd)`;
      } else if (ptsWin > secondPts) {
        // Draw not enough but win is
        return `${r.team}: MUST WIN — draw (${ptsDraw}pts) not enough to advance; loss or draw = go home. Expect maximum desperation and risk-taking.`;
      } else if (ptsWin === secondPts) {
        return `${r.team}: MUST WIN and needs GD help — even a win only ties current 2nd on points`;
      } else {
        // Even a win doesn't reach 2nd's current pts — needs results elsewhere
        return `${r.team}: needs a win AND other group results to go their way — fighting spirit likely but outcome partly outside their control`;
      }
    }

    // Currently 1st or 2nd — risk of being overtaken
    const thirdMax = maxReachable[2] ?? 0;
    if (r.pts > thirdMax) {
      return null; // already caught by isQualified above, but defensive
    }
    // 3rd can still overtake them — a loss could drop them
    if (r.pts < thirdMax) {
      return `${r.team}: currently in top 2 but not locked — a loss risks dropping out; likely to play it safe rather than attack`;
    }
    return null;
  }

  const flags: string[] = [];
  const t1qual = t1 && isQualified(t1);
  const t2qual = t2 && isQualified(t2);
  const t1elim = t1 && isEliminated(t1);
  const t2elim = t2 && isEliminated(t2);

  if (t1qual && t2qual) {
    flags.push("STRATEGIC ALERT: Both teams already qualified — high probability of squad rotation, reduced intensity, and tactical positioning (deliberate result to shape bracket). Statistical model assumes full-strength lineups; predictions less reliable than usual.");
  } else if (t1elim && t2elim) {
    flags.push("NOTE: Both teams mathematically eliminated — dead rubber, expect rotation and reduced intensity.");
  } else {
    // At least one team has something at stake — add per-team stakes
    const stakes = [t1, t2].flatMap((t) => (t ? [teamStake(t)] : [])).filter(Boolean);
    if (stakes.length) flags.push("Match stakes:\n" + stakes.map((s) => `  • ${s}`).join("\n"));
  }

  const header = `Group ${match.group} standings before this match:`;
  return [header, ...qualLines, ...flags].join("\n");
}

// Fingerprint for a knockout fixture's prediction context.
// Encodes team names + result counts so that when either team resolves from a
// placeholder OR new results come in for either team, the cached prediction is
// automatically invalidated and regenerated with fresh tournament context.
function knockoutContextKey(
  match: Match,
  fixtures: Match[],
  results: Record<string, MatchResult>,
): string {
  const countResults = (team: string) =>
    fixtures.filter(
      (f) => (f.team1 === team || f.team2 === team) && !!results[f.id],
    ).length;
  return `${match.team1}|${match.team2}|${countResults(match.team1)}|${countResults(match.team2)}`;
}

// Returns a prompt-ready tournament path string for knockout matches.
// Gives the LLM each team's group-stage record, ranking, goals-per-game, and
// their knockout path to this point — so it can reason about tactical evolution
// (e.g. "team X averaged 3 goals/game in groups and may be more cautious now").
function buildKnockoutContext(
  match: Match,
  fixtures: Match[],
  results: Record<string, MatchResult>,
): string | null {
  if (match.stage !== "knockout") return null;
  if (CODED_TEAM.test(match.team1.trim()) || CODED_TEAM.test(match.team2.trim())) return null;

  function teamSummary(team: string): string {
    // Group stage record
    const groupGames = fixtures.filter(
      (f) => f.stage === "group" && (f.team1 === team || f.team2 === team),
    );
    let gW = 0, gD = 0, gL = 0, gGF = 0, gGA = 0, groupName = "";
    for (const f of groupGames) {
      groupName = groupName || f.group || "";
      const r = results[f.id];
      if (!r) continue;
      const isHome = f.team1 === team;
      const gf = isHome ? r.homeScore : r.awayScore;
      const ga = isHome ? r.awayScore : r.homeScore;
      gGF += gf; gGA += ga;
      if (gf > ga) gW++; else if (gf < ga) gL++; else gD++;
    }

    // Approximate group rank: count how many group teammates scored more points
    let groupRank = "";
    if (groupName) {
      const pts: Record<string, number> = {};
      for (const f of fixtures.filter((ff) => ff.stage === "group" && ff.group === groupName)) {
        const r = results[f.id];
        if (!r) continue;
        for (const [t, gf, ga] of [
          [f.team1, r.homeScore, r.awayScore],
          [f.team2, r.awayScore, r.homeScore],
        ] as [string, number, number][]) {
          if (CODED_TEAM.test(t.trim())) continue;
          pts[t] = (pts[t] || 0) + (gf > ga ? 3 : gf === ga ? 1 : 0);
        }
      }
      const myPts = pts[team] || 0;
      const higher = Object.values(pts).filter((p) => p > myPts).length;
      groupRank = higher === 0 ? "1st" : higher === 1 ? "2nd" : higher === 2 ? "3rd" : "4th";
    }

    // Previous knockout results for this team (not this match)
    const koWins: string[] = [];
    for (const f of fixtures.filter(
      (ff) => ff.stage === "knockout" && ff.id !== match.id &&
               (ff.team1 === team || ff.team2 === team),
    )) {
      const r = results[f.id];
      if (!r) continue;
      const isHome = f.team1 === team;
      const myG = isHome ? r.homeScore : r.awayScore;
      const opG = isHome ? r.awayScore : r.homeScore;
      const opp = isHome ? f.team2 : f.team1;
      if (myG > opG) koWins.push(`beat ${opp} ${myG}-${opG} (${f.round})`);
    }

    const gPlayed = gW + gD + gL;
    const gpg = gPlayed > 0 ? (gGF / gPlayed).toFixed(1) : "?";
    const gd = gGF - gGA;
    const groupLine = gPlayed > 0
      ? `Group ${groupName} (${groupRank}): ${gW}W ${gD}D ${gL}L | ${gGF} GF/${gGA} GA (GD${gd >= 0 ? "+" : ""}${gd}) | ${gpg} goals/game`
      : "(no group stage data)";
    const koLine = koWins.length > 0
      ? `KO path: ${koWins.join(" → ")}`
      : "KO path: first knockout game";

    return `  ${team}: ${groupLine} | ${koLine}`;
  }

  return [
    `Tournament path into this ${match.round}:`,
    teamSummary(match.team1),
    teamSummary(match.team2),
    `Knockout note: single elimination — no second chances. Both teams have now played multiple` +
    ` public matches; expect tactical adjustments from their group-stage patterns. Teams that` +
    ` scored freely in groups often adopt more conservative knockout shapes; defensively compact` +
    ` teams that absorbed pressure may look to disrupt and counter. Factor in cumulative fatigue` +
    ` and whether either team had an easier/harder path to this round.`,
  ].join("\n");
}

// Format the quantitative base (stat model + market + form + group context) for the LLM prompt.
function buildQuantBase(
  match: Match,
  base: { homeWin: number; draw: number; awayWin: number; expHome: number; expAway: number; likelyScore: string; over25: number } | null,
  market: { home: number; draw: number; away: number } | undefined,
  teamForm: string,
  groupContext: string | null,
  tournamentGoalsPerGame: number,
): string {
  const lines: string[] = [];
  if (base) {
    // Show BOTH expected goals (true model output) and mode score (most probable single outcome).
    // The LLM must anchor its score prediction to expHome/expAway, not just the mode — the mode
    // undersells the expected margin (e.g. expHome=2.85 but mode=2 due to Poisson floor).
    lines.push(
      `Statistical model (FIFA-rank prior + in-tournament form, Poisson, opponent-adjusted):` +
      ` ${match.team1} ${base.homeWin}% / draw ${base.draw}% / ${match.team2} ${base.awayWin}%` +
      ` | expected goals: ${match.team1} ${base.expHome} / ${match.team2} ${base.expAway}` +
      ` | most-likely single score: ${base.likelyScore} | over2.5: ${base.over25}%`,
    );
    lines.push(
      `Tournament context: this tournament is averaging ${(tournamentGoalsPerGame).toFixed(2)} goals/game` +
      ` — use this to calibrate whether the expected goals above are typical, high, or low for this competition.`,
    );
  }
  if (market) {
    lines.push(
      `Market implied (de-vigged): ${match.team1} ${Math.round(market.home * 100)}% / draw ${Math.round(market.draw * 100)}% / ${match.team2} ${Math.round(market.away * 100)}%`,
    );
  }
  if (teamForm) lines.push(`In-tournament form:\n${teamForm}`);
  if (groupContext) lines.push(`\n${groupContext}`);
  return lines.join("\n");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET" && req.method !== "POST") {
    return methodNotAllowed(res, ["GET", "POST"]);
  }

  try {
    const now = Date.now();

    const fixtures = await fetchFixtures();
    await setFixtures(fixtures);
    const ids = fixtures.map((m) => m.id);

    const [results, predictions] = await Promise.all([
      getResults(ids),
      getPredictions(ids),
    ]);

    // Closing/market implied probs per match — used both for grading the
    // market's pick and as part of the prediction's quantitative base.
    const closing = await getClosingLines().catch(
      () => ({}) as Record<string, MarketProbs>,
    );

    // Grade newly-finished matches (free). Closing odds (if captured) let us
    // grade the market's pick alongside the model's for the track record.
    // Also re-grade any knockout results cached before ET/pen fields were added
    // (knockoutWinner === undefined means the stored result predates those fields).
    for (const f of fixtures) {
      if (f.stage !== "knockout") continue;
      const r = results[f.id];
      if (r && r.knockoutWinner === undefined) {
        delete results[f.id]; // force re-grade to pick up pen/et data
      }
    }

    let newlyGraded = 0;
    try {
      const raw = await fetchResults();
      for (const f of fixtures) {
        if (results[f.id]) continue;
        const k = kickoffMs(f);
        if (k === null || k > now) continue;
        const found = findResult(f, raw);
        if (!found) continue;
        const graded = applyGrade(found, predictions[f.id], closing[f.id]);
        await setResult(graded);
        results[f.id] = graded;
        newlyGraded++;
      }
    } catch {
      /* results source flaky — continue */
    }

    // LAST-RESORT web-search grading: for matches well-finished (>4h) that no
    // free feed covered. Capped (paid tool); fires almost never since
    // openfootball is reliable. Skips prediction generation this call to stay
    // within the serverless timeout.
    const webGradeMax = Number(process.env.WORLDCUP_WEBGRADE_MAX || "1");
    let webGraded = 0;
    for (const f of fixtures) {
      if (webGraded >= webGradeMax) break;
      if (results[f.id]) continue;
      const k = kickoffMs(f);
      if (k === null || now - k < 4 * 60 * 60 * 1000) continue; // only well-finished
      if (CODED_TEAM.test(f.team1.trim()) || CODED_TEAM.test(f.team2.trim())) continue;
      try {
        const found = await fetchScoreViaWebSearch(f);
        if (!found) continue;
        const graded = applyGrade(found, predictions[f.id], closing[f.id]);
        await setResult(graded);
        results[f.id] = graded;
        newlyGraded++;
        webGraded++;
      } catch {
        /* web search optional */
      }
    }

    // Knockout cache invalidation: if a knockout prediction was generated when
    // teams were still placeholders OR before new results changed the context,
    // delete it so it gets regenerated with fresh tournament path context.
    for (const f of fixtures) {
      if (f.stage !== "knockout") continue;
      if (!predictions[f.id]) continue;
      if (results[f.id]) continue; // already finished — keep it
      if (CODED_TEAM.test(f.team1.trim()) || CODED_TEAM.test(f.team2.trim())) continue;
      const currentKey = knockoutContextKey(f, fixtures, results);
      if (predictions[f.id].contextKey !== currentKey) {
        delete predictions[f.id]; // stale — will regenerate below
      }
    }

    // Predict matches CLOSE to kickoff — only those starting within the rolling
    // window (default 24h) — so predictions use the freshest in-tournament form
    // rather than being generated a day or two early. Cache-first: already-
    // cached or finished matches are skipped. A few per call (timeout-bounded);
    // the page re-triggers until the window is filled. Soonest kickoff first.
    const recentContext = buildRecentContext(fixtures, results);
    const windowMs =
      Number(process.env.WORLDCUP_PREDICT_WINDOW_HOURS || "24") * 60 * 60 * 1000;
    const upcomingUncached = fixtures
      .filter((f) => {
        if (!f.kickoffUtc) return false;
        if (predictions[f.id] || results[f.id]) return false; // cache-first
        if (CODED_TEAM.test(f.team1.trim()) || CODED_TEAM.test(f.team2.trim()))
          return false;
        const k = new Date(f.kickoffUtc).getTime();
        return !Number.isNaN(k) && k > now && k - now <= windowMs; // within window, not started
      })
      .sort((a, b) => (a.kickoffUtc as string).localeCompare(b.kickoffUtc as string));
    // Per-call cap: 1 fits one Opus prediction in <60s (Hobby). Raise on Pro.
    const perCall = Number(process.env.WORLDCUP_MAX_PREDICTIONS || "1");
    // Don't generate overnight: gate to after the configured PST hour.
    const genStartHour = Number(process.env.WORLDCUP_GEN_START_HOUR_PST || "7");
    // Skip predictions in a call that already spent time on web-grading, to
    // stay within the serverless timeout (the page re-triggers for predictions).
    const genAllowed = pstHour(now) >= genStartHour && webGraded === 0;
    const toPredict = genAllowed ? upcomingUncached.slice(0, perCall) : [];

    // Statistical base (FIFA prior + in-tournament form, Poisson) — the
    // grounded foundation the LLM anchors to.
    const statModel = buildStatModel(fixtures, results);

    let newlyPredicted = 0;
    const predictErrors: string[] = [];
    for (const f of toPredict) {
      try {
        const teamForm = await buildTeamForm(f, fixtures, results);
        const matchContext = buildGroupContext(f, fixtures, results)
          ?? buildKnockoutContext(f, fixtures, results);
        const quantBase = buildQuantBase(f, statModel.predict(f), closing[f.id], teamForm, matchContext, statModel.leagueAvg * 2);
        const pred: Prediction = await predictMatch(f, {
          lang: "zh",
          recentContext,
          teamForm,
          quantBase,
        });
        if (f.stage === "knockout") {
          pred.contextKey = knockoutContextKey(f, fixtures, results);
        }
        // Snapshot market probs at prediction time so CLV can be computed at grading.
        if (closing[f.id]) {
          pred.marketProbsAtPrediction = closing[f.id];
        }
        await setPrediction(pred);
        predictions[f.id] = pred;
        newlyPredicted++;
      } catch (e) {
        predictErrors.push(`${f.id}: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    // Recompute accuracy (model + market + CLV)
    // graded = matches where a prediction was made AND a result exists (outcomeHit not null).
    // This is the fair denominator for model hit rate; it excludes matches without predictions.
    let totalResults = 0; // all matches with results (for resultsCount display)
    let graded = 0;
    let outcomeHits = 0;
    let exactHits = 0;
    let marketGraded = 0;
    let marketHits = 0;
    let clvGraded = 0;
    let clvSum = 0;
    let clvPositive = 0;
    for (const id of ids) {
      const r = results[id];
      if (!r) continue;
      totalResults++;
      // Only count toward model accuracy when a prediction was actually made
      if (r.outcomeHit !== null && r.outcomeHit !== undefined) {
        graded++;
        if (r.outcomeHit) outcomeHits++;
      }
      if (r.exactHit !== null && r.exactHit !== undefined) {
        if (r.exactHit) exactHits++;
      }
      if (r.marketHit != null) {
        marketGraded++;
        if (r.marketHit) marketHits++;
      }
      if (r.clv != null) {
        clvGraded++;
        clvSum += r.clv;
        if (r.clv > 0) clvPositive++;
      }
    }
    const avgClv = clvGraded > 0 ? Math.round((clvSum / clvGraded) * 10) / 10 : 0;

    const meta: WorldCupMeta = {
      lastSyncAt: new Date().toISOString(),
      fixturesCount: fixtures.length,
      predictionsCount: Object.keys(predictions).length,
      resultsCount: totalResults,
      accuracy: { graded, outcomeHits, exactHits, marketGraded, marketHits, clvGraded, avgClv, clvPositive },
    };
    await setMeta(meta);

    return sendJson(res, 200, {
      ok: true,
      fixturesCount: fixtures.length,
      newlyGraded,
      newlyPredicted,
      predictionsCount: meta.predictionsCount,
      // Uncached matches still in the rolling window — the page re-triggers
      // /refresh while this is > 0 (and progress is being made). 0 before the
      // PST cutoff so the page doesn't loop pointlessly.
      remaining: genAllowed ? upcomingUncached.length - newlyPredicted : 0,
      predictErrors,
    });
  } catch (error) {
    return serverError(res, error);
  }
}
