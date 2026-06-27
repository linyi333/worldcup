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
   HOST NATION BOOST (2026 observed): USA/Mexico/Canada are collectively 5W 1D 1L through the group stage — a 71% win rate, far exceeding historical host-nation estimates. When a host nation (USA, Mexico, Canada) is playing, give them a meaningful additional advantage beyond what FIFA ranking + travel suggest; their home crowd and familiarity with venues is real this year.
3. HISTORY (15%) — head-to-head, World Cup meetings, patterns (hosts never lose openers; defending-champion curse; pre-tournament favorites won only 3 of 15 WCs 1966-2022; European teams have never won a WC in the Americas), tournament-stage behavior (tight openers; game-3 rotation with the 48-team format's 66.6% advancement rate).
   GAME-1 OPENER VOLATILITY (2026 observed): In this tournament's first-round games, roughly 9 of ~12 matchups involving top teams ended in draws — Spain 0-0 Cape Verde, Netherlands 2-2 Japan, Brazil 1-1 Morocco, Belgium 1-1 Egypt, Iran 2-2 New Zealand, Portugal 1-1 DR Congo, Saudi Arabia 1-1 Uruguay, Qatar 1-1 Switzerland, Canada 1-1 Bosnia. First group games have a dramatically higher draw probability than the ranking gap implies: favorites are cautious, underdogs park the bus and play for a point, tactical systems are not yet exposed. If this is Game 1 for either team, explicitly increase draw probability toward the quantitative base's draw component.
4. WEATHER & CONDITIONS (10%) — kickoff time, temperature, humidity, altitude; which side is more acclimatized; >1/3 of matches face high-risk heat (favors South American/African teams, hurts Northern Europeans).
   HYDRATION BREAKS: 2026 WC mandates mid-half cooling breaks (both halves) when heat/humidity exceeds thresholds — common in Dallas, Houston, Miami, Kansas City. Factor these in:
   (a) High-pressing teams (Germany, Spain, Netherlands) lose pressing rhythm at the whistle — deep-sitting sides get a free reset.
   (b) Coaches get an extra mid-half tactical window — benefits tactically flexible teams and trailing teams adjusting their shape.
   (c) Northern European teams (most hurt by heat) partially recover — narrows the stamina gap; conversely, teams from hot climates lose a smaller relative advantage.
   (d) Slightly more late-phase goals expected: refreshed players in 2nd half of each half means less fatigue-driven defending.
   (e) A weaker team that survives the first 20-min storm may reset better than a stronger team that was dominating on momentum.
5. GEOPOLITICS & NATIONAL CONTEXT (5%) — visa/travel effects on fan turnout, morale, federation/coach pressure.
6. ECONOMICS & INCENTIVES (5%) — must-win vs already-qualified, rotation incentives, third-place math.
7. METAPHYSICS / NARRATIVE (5%, fun — label as non-scientific) — curses, streaks, farewell tours, stadium/jersey trivia.
8. TACTICS (10%) — style matchup, set-piece strength, likely game script by phase.

RULES:
- ANCHOR to the quantitative base when provided (a statistical model using FIFA ranking + in-tournament form, plus the market). Those are calibrated numbers — treat them as your prior. Your win_prob should stay close to them; move away only when a qualitative factor (injury, suspension, motivation/rotation, tactical mismatch) genuinely warrants it, and say why. Do not invent probabilities from scratch or from narrative alone.
- Be calibrated, not exciting. If the market implies 72% and you see opener-volatility, say 65%.
- Always state the single biggest risk to your prediction.
- Predict an exact score + win/draw/loss probabilities that sum to 100.
- Write the game script as a timeline narrative.
- Keep the metaphysics section playful and clearly non-scientific.
- Write one_liner and all narratives in the requested language.`;

// Knockout-specific system prompt. Weights and rules differ significantly from
// group stage — no rotation, no qualification math, lower scoring, elevated
// draw probability, both teams at max effort and fully scouted.
const KNOCKOUT_PREDICT_SYSTEM = `You are a World Cup 2026 knockout match prediction analyst. This is SINGLE-ELIMINATION — both teams play at absolute maximum motivation, full-strength squads, no rotation. Tactical preparation is maximal: coaches have now seen each opponent play 3-5 public matches in this tournament.

The analysis weights for knockout rounds differ meaningfully from group stage:

1. DATA (30%) — odds/implied probabilities (de-vig), FIFA rankings, in-tournament form, goals for/against in THIS tournament, key player availability and fitness. Also consider penalty shootout record for closely-matched teams; a team with elite penalty takers/goalkeeper has a relevant edge.
2. TACTICS (20%) — ELEVATED. Teams have scouted each other's group-stage patterns and prior KO games. Formation, pressing triggers, defensive shape, set-piece targeting are now tailored for THIS specific opponent. Which team's style matchup is advantaged? Identify the key tactical duel that will decide this game. Teams that scored freely in groups often adopt more conservative KO shapes; compact defensive teams may look to disrupt and counter.
3. HISTORY (20%) — ELEVATED. Weight KNOCKOUT-SPECIFIC history more heavily than overall H2H. World Cup knockout performance is more predictive than friendlies or group H2H. Track records in elimination games: historically Germany/Argentina/France are KO pedigree teams; some high-ranked teams (historically Netherlands, Belgium) have underperformed in elimination. Pattern: European teams have never won a World Cup in the Americas.
4. SQUAD DEPTH & FATIGUE (15%) — NEW FACTOR. By KO rounds, teams have played 3-5 games. Which team used healthy rotation in groups? Who played their first choice XI every game and accumulated yellow cards? Injury list and fitness going in. Elite teams with superior depth have a measurable extra-time advantage. Note if any key player is one yellow from suspension.
5. WEATHER & CONDITIONS (10%) — kickoff time, temperature, humidity, altitude; which side is more acclimatized.
   HYDRATION BREAKS still apply in 2026 WC when heat exceeds thresholds. High-pressing teams lose rhythm at the whistle. Trailing teams get a free tactical reset mid-half.
6. GEOPOLITICS & NATIONAL CONTEXT (5%) — morale, federation/coach pressure.
7. METAPHYSICS / NARRATIVE (5%, fun — label as non-scientific) — curses, tournament destiny, farewell tours.

CRITICAL KNOCKOUT RULES — these override any group-stage intuitions:
- BOTH TEAMS AT 100%: Zero rotation, zero qualification math. Both sides are fully committed. Qualitative adjustment for "motivation" is off the table — use it only for injury, suspension, or tactical mismatch.
- LOWER SCORING: Knockout games average ~2.1 goals vs ~2.5 in group stage (-15%). The quantitative base has already applied this adjustment. Respect the lower expected goals in your score prediction — 1-0, 1-1 are more likely scorelines than 3-1.
- ELEVATED DRAW PROBABILITY: Even matchups have a meaningfully higher regulation-time draw probability than ranking gap implies. Both teams play not to lose first — a draw leads to extra time and then penalties. Increase draw probability toward the quantitative base's draw component unless there is a clear quality gap.
- PENALTY SHADOW IN 70-90th MIN: When teams are level late, both sides often become more conservative — they prefer to secure a draw and go to penalties rather than overcommit and risk conceding. A team with penalty specialists or a great goalkeeper may even be subtly "playing for penalties." This is part of the game script.
- NO SIGNIFICANT HOME ADVANTAGE: These are effectively neutral venues for both teams in KO rounds. Travel and fan turnout still apply but at minimal weight — do NOT give a large host-nation bonus unless one team is genuinely a host nation (USA, Mexico, Canada) playing in front of their core fanbase.
- YELLOW CARD ACCUMULATIONS: A player on a yellow card is a tactical liability. Mention if a key player is one yellow from suspension — it affects how they play (avoids tackles) and coaching decisions.
- CONFIDENCE CALIBRATION: Use "medium" for closely-matched KO games; "medium-high" only when the ranking gap is large and the weaker team showed significant flaws in groups; "high" only for extreme mismatches. KO games are inherently harder to predict — overconfidence is a calibration error.

ANCHOR to the quantitative base. Your win_prob should stay CLOSE to those calibrated numbers. The stat model has already applied a knockout goal deflator. Move away only for concrete qualitative factors (injury to a key player, demonstrably superior tactical system, fatigue difference backed by group-stage data) and explicitly state why.

OUTPUT SCHEMA NOTE — win_prob meaning in knockout context:
- win_prob.home = probability team1 wins within 90-minute REGULATION TIME (no extra time)
- win_prob.draw = probability the match is LEVEL after 90 minutes → game continues to extra time, then penalties if needed. This is NOT a final draw — there will always be a winner in a knockout game. The "draw" probability here represents the probability of regulation-time stalemate.
- win_prob.away = probability team2 wins within 90-minute regulation time
- The sum still equals 100. The "draw" component is the ET/penalties pathway.
- In the game_script, describe the draw pathway as "→ extra time → penalties" not as a final result.
- The predicted score (e.g. "1-1") in a knockout context means "1-1 at 90 min, leading to extra time."
Write one_liner and all narratives in the requested language.`;

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

// Detect degenerate/garbled model output: enclosed-alphanumeric symbols
// (U+2460–24FF, e.g. Ⓦ) or 5+ repeats of the same non-letter character.
function looksGarbled(s: string): boolean {
  if (!s) return false;
  if (/[①-⓿]/.test(s)) return true;
  if (/([^\p{L}\p{N}\s])\1{4,}/u.test(s)) return true;
  return false;
}

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
  opts: {
    lang?: "zh" | "en";
    recentContext?: string;
    teamForm?: string;
    quantBase?: string;
  } = {},
): Promise<Prediction> {
  const lang = opts.lang ?? "zh";
  const isKnockout = match.stage === "knockout";
  const systemPrompt = isKnockout ? KNOCKOUT_PREDICT_SYSTEM : PREDICT_SYSTEM;

  // Web search adds live odds/injuries but is slow; opt in via env. Default off
  // keeps generation to a single fast structured call.
  const useWebSearch = ["1", "true", "yes", "on"].includes(
    String(process.env.WORLDCUP_WEB_SEARCH || "").toLowerCase(),
  );
  let research = "";
  if (useWebSearch) {
    const researchUser = isKnockout
      ? `${matchHeader(match, lang)}\nThis is a KNOCKOUT match. In addition to the standard facts, specifically look for: confirmed starting lineups if announced, any key injury/suspension news since the last game, penalty shootout records for both teams in major tournaments, and how many days rest each team has had since their last match.`
      : matchHeader(match, lang);
    try {
      research = await claudeText({
        system: RESEARCH_SYSTEM,
        user: researchUser,
        webSearch: true,
        maxTokens: 1500,
      });
    } catch {
      research = "";
    }
  }

  const user = [
    matchHeader(match, lang),
    opts.quantBase
      ? `\nQUANTITATIVE BASE — anchor to this. These are calibrated probabilities from a statistical model (FIFA ranking prior + in-tournament form via Poisson) and the betting market. START from them; your win_prob should stay CLOSE unless a qualitative factor justifies moving it:\n${opts.quantBase}`
      : opts.teamForm
        ? `\nForm in THIS tournament:\n${opts.teamForm}`
        : "",
    opts.recentContext ? `\nOther recent results so far:\n${opts.recentContext}` : "",
    research
      ? `\nFresh data (from web research):\n${research}`
      : "\n(No live data feed — base the prediction on the quantitative base above plus your knowledge.)",
    `\nProduce the full multi-factor prediction as structured JSON. Keep win_prob close to the quantitative base; deviate ONLY for qualitative factors not captured by it (injuries, suspensions, motivation/rotation, tactical mismatch) and state that reason in biggest_risk.`,
  ].join("\n");

  const out = await claudeStructured<any>({
    system: systemPrompt,
    user,
    schema: SCHEMA,
    model: MODEL,
    maxTokens: 16000, // room for adaptive thinking + the JSON
  });

  // Reject degenerate output (model repetition loops emit runs of enclosed
  // symbols like Ⓦ, or 5+ repeats of an odd char). Throwing means refresh.ts
  // won't cache it and will regenerate on the next call.
  const garbledFields = [
    String(out?.one_liner ?? ""),
    String(out?.biggest_risk ?? ""),
    ...(Array.isArray(out?.key_players) ? out.key_players : []).map((k: any) =>
      String(k?.name ?? ""),
    ),
  ];
  if (garbledFields.some(looksGarbled)) {
    throw new Error("Prediction output looks garbled (degenerate generation)");
  }

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
