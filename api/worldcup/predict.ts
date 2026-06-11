import { claudeStructured, claudeText } from "../_lib/anthropic.js";
import type { Match, Prediction } from "./types.js";

const MODEL = "claude-opus-4-8";

// ---- System prompts ---------------------------------------------------------

const RESEARCH_SYSTEM = `You are a football data researcher for the 2026 World Cup (hosts USA/Mexico/Canada, June 11 – July 19, 2026).
For the given match, use web search to gather the FRESHEST available facts and return them as concise bullet notes (no analysis, just sourced facts):
- Betting odds / implied win probabilities (moneyline home/draw/away, over-under 2.5 line) if published
- Recent form: each team's last ~8 results
- Injuries, suspensions, minutes restrictions for key players
- Weather forecast for the venue/kickoff (temp, humidity, conditions; note altitude for Mexico City, heat for Dallas/Houston/Miami/KC)
- Any relevant news (federation drama, must-win/rotation context)
If a fact is unavailable, say so briefly. Keep it under ~300 words. Do not invent data.`;

const PREDICT_SYSTEM = `You are a World Cup 2026 match prediction analyst. You combine quantitative analysis, football history, and contextual factors into a single calibrated prediction. The tournament is hosted by USA (78 matches), Mexico (13), and Canada (13), June 11 – July 19, 2026. Format: 48 teams, 12 groups, top 2 + 8 best third-place teams advance to a Round of 32.

For each match, analyze ALL of the following dimensions:
1. DATA (35%) — odds/implied probabilities (de-vig), FIFA rankings, recent form (last 8), goals for/against, clean sheets, key player availability, xG trends.
2. HOME / HOST ADVANTAGE (15%) — always evaluate explicitly: crowd & fan ratio, referee bias (~10-15% more penalties for home sides), travel fatigue (huge in this tournament), altitude/climate (Mexico City 2,240m; extreme heat in Dallas/Houston/Miami/KC), negative home advantage for cross-border bases.
3. HISTORY (15%) — head-to-head, World Cup meetings, patterns (hosts never lose openers; defending-champion curse; pre-tournament favorites won only 3 of 15 WCs 1966-2022; European teams have never won a WC in the Americas), tournament-stage behavior (tight openers; game-3 rotation with the 48-team format's 66.6% advancement rate).
4. WEATHER & CONDITIONS (10%) — kickoff time, temperature, humidity, altitude; which side is more acclimatized; >1/3 of matches face high-risk heat (favors South American/African teams, hurts Northern Europeans).
5. GEOPOLITICS & NATIONAL CONTEXT (5%) — visa/travel effects on fan turnout, morale, federation/coach pressure.
6. ECONOMICS & INCENTIVES (5%) — must-win vs already-qualified, rotation incentives, third-place math.
7. METAPHYSICS / NARRATIVE (5%, fun — label as non-scientific) — curses, streaks, farewell tours, stadium/jersey trivia.
8. TACTICS (10%) — style matchup, set-piece strength, likely game script by phase.

RULES:
- Be calibrated, not exciting. If the market implies 72% and you see opener-volatility, say 65%.
- Always state the single biggest risk to your prediction.
- Predict an exact score + win/draw/loss probabilities that sum to 100.
- Write the game script as a timeline narrative.
- Keep the metaphysics section playful and clearly non-scientific.
- Write one_liner and all narratives in the requested language.`;

// ---- Output schema (Anthropic structured outputs) ---------------------------

function obj(props: Record<string, unknown>, required?: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: required ?? Object.keys(props),
    properties: props,
  };
}
const str = { type: "string" };

const SCHEMA = obj({
  prediction: obj({
    score: str,
    win_prob: obj({ home: { type: "number" }, draw: { type: "number" }, away: { type: "number" } }),
    confidence: { type: "string", enum: ["low", "medium", "medium-high", "high"] },
    over_under_2_5: { type: "string", enum: ["over", "under"] },
    first_goal_window: str,
  }),
  factors: obj({
    data: obj({ summary: str, edge: { type: "string", enum: ["home", "away", "neutral"] } }),
    home_advantage: obj({
      crowd: str,
      travel: str,
      climate_altitude: str,
      referee: str,
      net_goal_value: str,
    }),
    history: obj({ h2h: str, patterns: str }),
    weather: obj({ conditions: str, impact: str }),
    politics: obj({ summary: str }),
    tactics: obj({ matchup: str, key_battle: str }),
    metaphysics: obj({ fun_fact: str }),
  }),
  game_script: str,
  biggest_risk: str,
  key_players: {
    type: "array",
    items: obj({ name: str, team: str, why: str }),
  },
  one_liner: str,
}) as Record<string, unknown>;

// ---- Helpers ----------------------------------------------------------------

function normalizeWinProb(wp: { home?: number; draw?: number; away?: number }) {
  const home = Math.max(0, wp?.home ?? 0);
  const draw = Math.max(0, wp?.draw ?? 0);
  const away = Math.max(0, wp?.away ?? 0);
  const sum = home + draw + away;
  if (sum <= 0) return { home: 34, draw: 33, away: 33 };
  const scale = 100 / sum;
  const h = Math.round(home * scale);
  const d = Math.round(draw * scale);
  return { home: h, draw: d, away: 100 - h - d };
}

const VALID_CONF = ["low", "medium", "medium-high", "high"];

function matchHeader(match: Match, lang: "zh" | "en") {
  return [
    `Match: ${match.team1} (home) vs ${match.team2} (away)`,
    `Stage: ${match.round}${match.group ? ` | ${match.group}` : ""}`,
    `Venue: ${match.ground} | Kickoff (raw): ${match.timeRaw} on ${match.date}`,
    `Language for one_liner and narratives: ${lang}`,
  ].join("\n");
}

/**
 * Two-step prediction: research (web_search) → structured JSON. Keeping the
 * tool call and the schema constraint in separate requests avoids them fighting.
 * `recentContext` is a short note of just-played results so earlier matches
 * inform today's prediction.
 */
export async function predictMatch(
  match: Match,
  opts: { lang?: "zh" | "en"; recentContext?: string } = {},
): Promise<Prediction> {
  const lang = opts.lang ?? "zh";

  // Web search adds live odds/injuries but is slow; opt in via env. Default off
  // keeps generation to a single fast structured call.
  const useWebSearch = ["1", "true", "yes", "on"].includes(
    String(process.env.WORLDCUP_WEB_SEARCH || "").toLowerCase(),
  );
  let research = "";
  if (useWebSearch) {
    try {
      research = await claudeText({
        system: RESEARCH_SYSTEM,
        user: matchHeader(match, lang),
        webSearch: true,
        maxTokens: 1500,
      });
    } catch {
      research = "";
    }
  }

  const user = [
    matchHeader(match, lang),
    opts.recentContext ? `\nRecent tournament results so far:\n${opts.recentContext}` : "",
    research
      ? `\nFresh data (from web research):\n${research}`
      : "\n(No live data feed — base the prediction on your knowledge of the teams and any recent results above.)",
    `\nProduce the full multi-factor prediction as structured JSON.`,
  ].join("\n");

  const out = await claudeStructured<any>({
    system: PREDICT_SYSTEM,
    user,
    schema: SCHEMA,
    model: MODEL,
    maxTokens: 16000, // room for adaptive thinking + the JSON
  });

  const confidence = VALID_CONF.includes(out?.prediction?.confidence)
    ? out.prediction.confidence
    : "medium";

  return {
    matchId: match.id,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    score: String(out?.prediction?.score ?? ""),
    winProb: normalizeWinProb(out?.prediction?.win_prob ?? {}),
    confidence,
    oneLiner: String(out?.one_liner ?? ""),
    detail: out,
  };
}
