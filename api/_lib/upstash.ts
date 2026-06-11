import { getRequiredEnv } from "./env.js";

// Minimal Upstash Redis REST client.
// Reusable beyond the World Cup feature — kept in _lib so it survives
// teardown of api/worldcup/.
//
// Requires env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

// Tolerate values that were quoted in .env.local (the project's parser doesn't
// strip surrounding quotes).
function unquote(v: string): string {
  return v.trim().replace(/^["']|["']$/g, "");
}

async function command<T = unknown>(args: (string | number)[]): Promise<T> {
  const url = unquote(getRequiredEnv("UPSTASH_REDIS_REST_URL"));
  const token = unquote(getRequiredEnv("UPSTASH_REDIS_REST_TOKEN"));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash command failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { result?: T; error?: string };
  if (data.error) {
    throw new Error(`Upstash error: ${data.error}`);
  }
  return data.result as T;
}

export async function redisSetJson(key: string, value: unknown): Promise<void> {
  await command(["SET", key, JSON.stringify(value)]);
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const raw = await command<string | null>(["GET", key]);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function redisMGetJson<T>(keys: string[]): Promise<Record<string, T>> {
  if (keys.length === 0) return {};
  const raws = await command<(string | null)[]>(["MGET", ...keys]);
  const out: Record<string, T> = {};
  keys.forEach((key, i) => {
    const raw = raws?.[i];
    if (raw == null) return;
    try {
      out[key] = JSON.parse(raw) as T;
    } catch {
      /* skip unparseable */
    }
  });
  return out;
}

export async function redisDelByPrefix(prefix: string): Promise<number> {
  const keys = await command<string[]>(["KEYS", `${prefix}*`]);
  if (!keys || keys.length === 0) return 0;
  return command<number>(["DEL", ...keys]);
}
