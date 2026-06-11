import {
  redisGetJson,
  redisMGetJson,
  redisSetJson,
} from "../_lib/upstash.js";
import type {
  Match,
  MatchResult,
  Prediction,
  WorldCupMeta,
} from "./types.js";

// All keys are namespaced under `worldcup:` so teardown is a single
// redisDelByPrefix("worldcup:") (see upstash.ts).
const NS = "worldcup:";
const K_FIXTURES = `${NS}fixtures`;
const K_META = `${NS}meta`;
const kPrediction = (id: string) => `${NS}prediction:${id}`;
const kResult = (id: string) => `${NS}result:${id}`;

export async function setFixtures(matches: Match[]): Promise<void> {
  await redisSetJson(K_FIXTURES, matches);
}

export async function getFixtures(): Promise<Match[]> {
  return (await redisGetJson<Match[]>(K_FIXTURES)) ?? [];
}

export async function getMeta(): Promise<WorldCupMeta | null> {
  return redisGetJson<WorldCupMeta>(K_META);
}

export async function setMeta(meta: WorldCupMeta): Promise<void> {
  await redisSetJson(K_META, meta);
}

export async function setPrediction(p: Prediction): Promise<void> {
  await redisSetJson(kPrediction(p.matchId), p);
}

export async function getPredictions(ids: string[]): Promise<Record<string, Prediction>> {
  const map = await redisMGetJson<Prediction>(ids.map(kPrediction));
  const out: Record<string, Prediction> = {};
  for (const id of ids) {
    const v = map[kPrediction(id)];
    if (v) out[id] = v;
  }
  return out;
}

export async function setResult(r: MatchResult): Promise<void> {
  await redisSetJson(kResult(r.matchId), r);
}

export async function getResults(ids: string[]): Promise<Record<string, MatchResult>> {
  const map = await redisMGetJson<MatchResult>(ids.map(kResult));
  const out: Record<string, MatchResult> = {};
  for (const id of ids) {
    const v = map[kResult(id)];
    if (v) out[id] = v;
  }
  return out;
}
