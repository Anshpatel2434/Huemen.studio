/**
 * One real background removal, timed: the check to run on a host before
 * switching Remove background on there (it needs CPU time and memory the rest
 * of the app does not).
 *
 *   npm run smoke:cutout                 a 1024 x 1280 test picture
 *   npm run smoke:cutout -- photo.png    a picture of your own
 *
 * Uses the same provider the app does (lib/ai/providers/cutout-onnx) and the
 * model at AI_CUTOUT_MODEL_PATH (default ./models/isnet-general-use.onnx;
 * fetch it with `npm run models:fetch`). Touches no database and no storage:
 * it writes the cut-out to a temporary folder and prints where, how long the
 * first run took (it opens the model) and a second one, how much of the
 * picture was kept, and the most memory the process held.
 */
import "dotenv/config";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { onnxCutoutProvider } from "../src/lib/ai/providers/cutout-onnx";

/** A test picture: a soft backdrop with one clear subject in the middle. */
async function testPicture(width: number, height: number): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ea"/><stop offset="1" stop-color="#b9c4cc"/></linearGradient>
      <radialGradient id="m" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="#e2574c"/><stop offset="1" stop-color="#8f2018"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <ellipse cx="${width / 2}" cy="${height * 0.86}" rx="${width * 0.3}" ry="${height * 0.03}" fill="#8e99a1"/>
    <rect x="${width * 0.3}" y="${height * 0.4}" width="${width * 0.4}" height="${height * 0.45}" rx="${width * 0.05}" fill="url(#m)"/>
    <path d="M ${width * 0.7} ${height * 0.5} q ${width * 0.16} ${height * 0.1} 0 ${height * 0.2}" fill="none" stroke="#8f2018" stroke-width="${width * 0.035}" stroke-linecap="round"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

async function main() {
  const file = process.argv[2];
  const modelPath = process.env.AI_CUTOUT_MODEL_PATH || "./models/isnet-general-use.onnx";
  const source = file ? new Uint8Array(readFileSync(file)) : await testPicture(1024, 1280);
  const meta = await sharp(Buffer.from(source)).metadata();
  console.log(`Picture: ${file ?? "the built-in test picture"}, ${meta.width} x ${meta.height}`);
  console.log(`Model: ${modelPath}`);

  // The most memory held at any moment, sampled while the model works.
  const before = process.memoryUsage().rss;
  let peak = before;
  const watch = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 20);

  const provider = onnxCutoutProvider({ modelPath });
  let t = Date.now();
  const first = await provider.cutout(source);
  const firstMs = Date.now() - t;
  t = Date.now();
  const second = await provider.cutout(source);
  const secondMs = Date.now() - t;
  clearInterval(watch);
  peak = Math.max(peak, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024);

  const out = mkdtempSync(join(tmpdir(), "huemen-cutout-"));
  writeFileSync(join(out, "cutout.png"), first.bytes);
  const made = await sharp(Buffer.from(first.bytes)).metadata();
  console.log(`First cut-out (opens the model): ${(firstMs / 1000).toFixed(1)}s`);
  console.log(`Second cut-out (model already open): ${(secondMs / 1000).toFixed(1)}s`);
  console.log(`Kept ${(first.coverage * 100).toFixed(1)}% of the picture; PNG ${made.width} x ${made.height}, alpha: ${made.hasAlpha ? "yes" : "no"}; same result twice: ${first.coverage === second.coverage ? "yes" : "no"}`);
  console.log(`Memory: ${mb(before)} before, ${mb(peak)} at the most (${mb(peak - before)} more), ${mb(process.memoryUsage().rss)} afterwards with the model kept open`);
  console.log(`Model name logged: ${first.model}`);
  console.log(`Cut-out written to ${join(out, "cutout.png")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
