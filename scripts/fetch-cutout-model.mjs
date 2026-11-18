#!/usr/bin/env node
/**
 * Fetch the model that Remove background runs (Visual board): ISNet
 * general-use, as ONNX, about 179 MB, from the rembg project's release.
 *
 *   npm run models:fetch
 *
 * It goes into ./models/ (git-ignored; AI_CUTOUT_MODEL_PATH points at it) and
 * is checked against a pinned SHA-256 before it is put in place. A file that
 * does not match is deleted and the script fails: a model is code the server
 * runs, so only the exact file that was tested is ever used. To move to
 * another model build, change MODEL below (url, size and hash together) in a
 * reviewed commit.
 *
 * Safe to run again: a file already in place that matches is left alone.
 * Then switch the tool on: AI_CUTOUT_PROVIDER=onnx in .env.
 *
 * Licence: the model is Apache-2.0 (github.com/xuebinqin/DIS); confirm the
 * licence file before shipping it to a client (docs/decisions.md, "Picture
 * tools").
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const MODEL = {
  name: "isnet-general-use.onnx",
  url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
  // Pinned from the first download (2026-11-18): 178,648,008 bytes. The same
  // file rembg itself pins by md5 (fc16ebd8b0c10d971d3513d564d01e29).
  sha256: "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "models");
const dest = join(dir, MODEL.name);
const part = `${dest}.part`;

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function sha256Of(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** Report a file's size and hash, and say whether it is the pinned one. */
async function check(file) {
  const size = statSync(file).size;
  const sha = await sha256Of(file);
  console.log(`  size   ${size} bytes (${mb(size)})`);
  console.log(`  sha256 ${sha}`);
  return sha === MODEL.sha256;
}

async function download() {
  console.log(`Downloading ${MODEL.url}`);
  const res = await fetch(MODEL.url, { redirect: "follow", headers: { "User-Agent": "node" } });
  if (!res.ok || !res.body) throw new Error(`The download failed with ${res.status}.`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let got = 0;
  let said = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 10) : 0;
    if (pct > said) {
      said = pct;
      console.log(`  ${pct * 10}% (${mb(got)})`);
    }
  });
  await pipeline(body, createWriteStream(part));
}

async function main() {
  mkdirSync(dir, { recursive: true });

  if (existsSync(dest)) {
    console.log(`Already there: ${dest}`);
    if (await check(dest)) return console.log("It matches the pinned checksum. Nothing to do.");
    throw new Error(`The file at ${dest} is not the pinned model. Delete it and run this again.`);
  }

  // A download that finished but was not put in place (or one cut short) may be lying there.
  let have = existsSync(part);
  if (have) {
    console.log(`Found an earlier download: ${part}`);
    if (!(await check(part)) && MODEL.sha256) {
      console.log("It is not the pinned model (cut short, or changed). Fetching it again.");
      rmSync(part);
      have = false;
    }
  }
  if (!have) {
    await download();
    console.log("Downloaded.");
    await check(part);
  }

  if (!MODEL.sha256) {
    throw new Error("No checksum is pinned in this script, so the download was not put in place. Pin the sha256 printed above in MODEL.sha256, then run this again.");
  }
  if ((await sha256Of(part)) !== MODEL.sha256) {
    rmSync(part);
    throw new Error(`The download does not match the pinned checksum (${MODEL.sha256}), so it was deleted. Nothing was installed.`);
  }
  renameSync(part, dest);
  console.log(`Checksum matches. Model is at ${dest}`);
  console.log("Switch the tool on with AI_CUTOUT_PROVIDER=onnx in .env.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
