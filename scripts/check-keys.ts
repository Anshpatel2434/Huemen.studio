/**
 * `npm run check:keys`: where each provider key comes from (the .env files or
 * the process environment, which wins over them), and whether Runpod accepts
 * the RUNPOD_API_KEY in use and the one in .env, by one free, read-only call
 * each (lib/key-source, PI-41). Prints no key's value.
 */
import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { describeSource, keySources, probeRunpod, readDotenvFiles } from "../src/lib/key-source";

async function main() {
  const files = readDotenvFiles(process.cwd());
  // Next lays the .env files under what is already set; do the same here, so "in use" means what the app would use.
  const env: Record<string, string | undefined> = {};
  for (const f of files) Object.assign(env, f.values);
  Object.assign(env, process.env);
  for (const s of keySources(env, files)) console.log(describeSource(s));
  const model = env.AI_IMAGE_MODEL || "qwen-image-t2i";
  const inUse = env.RUNPOD_API_KEY;
  if (inUse) console.log(`Runpod, key in use: ${await probeRunpod(inUse, model)}`);
  const fileKey = existsSync(".env") ? parse(readFileSync(".env")).RUNPOD_API_KEY : undefined;
  if (fileKey && fileKey !== inUse) console.log(`Runpod, key in .env (not in use): ${await probeRunpod(fileKey, model)}`);
}

void main();
