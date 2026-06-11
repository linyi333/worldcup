import { getRequiredEnv } from "./env.js";

// Generic Claude (Anthropic) client. Reusable beyond the World Cup feature —
// kept in _lib so it survives teardown of api/worldcup/. This is the only piece
// of the World Cup work intended to live on as a backup/alternative to the
// existing OpenAI wrapper (api/_lib/openai.ts).
//
// Requires env: ANTHROPIC_API_KEY

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-8";
// max_uses bounds the server-side search loop so a request can't hang for minutes.
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 4,
};

type AnyBlock = { type: string; text?: string };
type ClaudeResponse = {
  content: AnyBlock[];
  stop_reason: string;
  stop_details?: { category?: string; explanation?: string };
};

async function call(body: Record<string, unknown>): Promise<ClaudeResponse> {
  const apiKey = getRequiredEnv("ANTHROPIC_API_KEY").trim().replace(/^["']|["']$/g, "");
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic request failed: ${res.status} ${text}`);
  }
  return (await res.json()) as ClaudeResponse;
}

function extractText(resp: ClaudeResponse): string {
  return (resp.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}

/**
 * Free-form completion, optionally with the server-side web_search tool so the
 * model can pull fresh data itself. Handles the `pause_turn` server-tool loop.
 */
export async function claudeText(params: {
  system: string;
  user: string;
  webSearch?: boolean;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const messages: { role: string; content: unknown }[] = [
    { role: "user", content: params.user },
  ];

  for (let i = 0; i < 3; i++) {
    const resp = await call({
      model: params.model ?? DEFAULT_MODEL,
      max_tokens: params.maxTokens ?? 8000,
      thinking: { type: "adaptive" },
      system: params.system,
      messages,
      ...(params.webSearch ? { tools: [WEB_SEARCH_TOOL] } : {}),
    });

    if (resp.stop_reason === "refusal") {
      throw new Error(`Claude refused: ${resp.stop_details?.category ?? "unknown"}`);
    }
    if (resp.stop_reason === "pause_turn") {
      // Server-side tool loop hit its iteration cap — resume.
      messages.push({ role: "assistant", content: resp.content });
      continue;
    }
    return extractText(resp);
  }
  throw new Error("Claude web_search did not converge within iteration cap");
}

/**
 * Schema-constrained completion. Returns parsed JSON guaranteed to match the
 * schema (Anthropic structured outputs). No tools — feed it any context you
 * already gathered (e.g. via claudeText with web_search).
 */
export async function claudeStructured<T>(params: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const resp = await call({
    model: params.model ?? DEFAULT_MODEL,
    max_tokens: params.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    system: params.system,
    messages: [{ role: "user", content: params.user }],
    output_config: { format: { type: "json_schema", schema: params.schema } },
  });

  if (resp.stop_reason === "refusal") {
    throw new Error(`Claude refused: ${resp.stop_details?.category ?? "unknown"}`);
  }
  const text = extractText(resp);
  if (!text) throw new Error("Claude returned empty structured content");
  return JSON.parse(text) as T;
}
