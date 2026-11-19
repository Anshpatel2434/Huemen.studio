/**
 * Where each provider key came from, said at start-up without its value
 * (PI-41). Next reads .env into the environment but never over a variable
 * that is already set, so a key set outside .env (a Windows user variable,
 * the host's settings) silently wins over the .env line. On 2026-11-19 the
 * .env RUNPOD_API_KEY was refused by Runpod (403) and this PC worked only on a
 * different key from a Windows user variable; any other host would have
 * failed every picture with no word why.
 *
 *   keySources   for each key: unset, from .env, or from the process
 *                environment (set outside .env), and whether a .env line
 *                says something else. Values are compared, never shown.
 *   probeRunpod  one free, read-only Runpod call (the status of a job id that
 *                does not exist) with the key in use: 401/403 = refused,
 *                anything else = accepted.
 *
 * Logged by src/instrumentation.ts once per server start; `npm run
 * check:keys` (scripts/check-keys.ts) says the same on demand. Server-only in
 * practice (reads files and the network), no `server-only` guard so the
 * script can use it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";

/** The keys whose source is reported. */
export const KEY_NAMES = ["RUNPOD_API_KEY", "GROQ_API_KEY", "AI_VISION_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;

export type KeySource =
  | { name: string; source: "unset" }
  | { name: string; source: "dotenv"; file: string }
  | { name: string; source: "process"; differsFrom: string | null };

/** The .env files Next reads, lowest first (a later one wins), as name/value maps. */
export function readDotenvFiles(dir: string, nodeEnv = process.env.NODE_ENV ?? "development"): { file: string; values: Record<string, string> }[] {
  const names = [".env", `.env.${nodeEnv}`, ...(nodeEnv === "test" ? [] : [".env.local"]), `.env.${nodeEnv}.local`];
  return names.flatMap((file) => {
    const path = join(dir, file);
    if (!existsSync(path)) return [];
    try {
      return [{ file, values: parse(readFileSync(path)) }];
    } catch {
      return [];
    }
  });
}

/**
 * Pure: where each key in `env` came from, given what the .env files say.
 * A key equal to the value the files give came from them; a set key the files
 * don't give, or give differently, came from the process environment (and
 * `differsFrom` names the file that says otherwise).
 */
export function keySources(env: Record<string, string | undefined>, files: { file: string; values: Record<string, string> }[], names: readonly string[] = KEY_NAMES): KeySource[] {
  return names.map((name): KeySource => {
    const value = env[name];
    if (!value) return { name, source: "unset" };
    // The file that wins for this name (the last one that sets it).
    const winner = [...files].reverse().find((f) => f.values[name]);
    if (winner && winner.values[name] === value) return { name, source: "dotenv", file: winner.file };
    return { name, source: "process", differsFrom: winner ? winner.file : null };
  });
}

/** One line per key, never a value. */
export function describeSource(s: KeySource): string {
  if (s.source === "unset") return `${s.name}: not set`;
  if (s.source === "dotenv") return `${s.name}: from ${s.file}`;
  return s.differsFrom
    ? `${s.name}: from the process environment (set outside the .env files), and ${s.differsFrom} has a DIFFERENT value that is not used`
    : `${s.name}: from the process environment (set outside the .env files)`;
}

/** What Runpod says to a key: accepted, refused, or it could not be asked. */
export type ProbeResult = "accepted" | "refused" | "unreachable";

/**
 * Ask Runpod whether a key is accepted: the status of a job id that does not
 * exist on a public endpoint. Free and read-only. Measured 2026-11-19: a
 * working key gets 400, a refused one 403, none 401.
 */
export async function probeRunpod(key: string, model: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  try {
    const res = await fetchImpl(`https://api.runpod.ai/v2/${encodeURIComponent(model)}/status/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.status === 401 || res.status === 403 ? "refused" : "accepted";
  } catch {
    return "unreachable";
  }
}

/**
 * The start-up report (src/instrumentation.ts): every key's source, a warning
 * where a .env line is overridden by a different value, and, with Runpod as
 * the picture provider, whether Runpod accepts the key in use. Never a value.
 */
export async function reportKeySources(log: (level: "info" | "warn", line: string) => void, opts: { dir?: string; probe?: boolean } = {}): Promise<KeySource[]> {
  const sources = keySources(process.env, readDotenvFiles(opts.dir ?? process.cwd()));
  for (const s of sources) {
    if (s.source === "unset") continue;
    log(s.source === "process" && s.differsFrom ? "warn" : "info", `keys: ${describeSource(s)}`);
  }
  const runpod = process.env.RUNPOD_API_KEY;
  if (opts.probe !== false && process.env.AI_IMAGE_PROVIDER === "runpod" && runpod) {
    const said = await probeRunpod(runpod, process.env.AI_IMAGE_MODEL || "qwen-image-t2i");
    const where = sources.find((s) => s.name === "RUNPOD_API_KEY");
    const from = where?.source === "dotenv" ? where.file : "the process environment";
    log(said === "refused" ? "warn" : "info", `keys: Runpod ${said === "accepted" ? "accepts" : said === "refused" ? "REFUSES" : "could not be asked about"} the RUNPOD_API_KEY in use (from ${from})`);
  }
  return sources;
}
