import fs from "fs";
import path from "path";

let localEnvLoaded = false;

function loadLocalEnvIfNeeded() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  const envFile = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envFile)) return;

  const raw = fs.readFileSync(envFile, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

export function getRequiredEnv(name: string): string {
  loadLocalEnvIfNeeded();
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getOpenAIModel(): string {
  loadLocalEnvIfNeeded();
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

export function getBooleanEnv(name: string, defaultValue = false): boolean {
  loadLocalEnvIfNeeded();
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}
