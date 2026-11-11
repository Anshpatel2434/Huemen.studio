/**
 * One real picture and one real area redraw, with whatever image provider the
 * environment names: the check to run once the OpenAI key is set.
 *
 *   npm run smoke:pictures
 *
 * Reads the same settings as the app (AI_IMAGE_PROVIDER=openai, OPENAI_API_KEY,
 * AI_IMAGE_MODEL) from the shell or .env. Touches no database and no storage:
 * it writes the two pictures to a temporary folder and prints where, how long
 * each call took, and whether anything outside the marked area moved after
 * Huemen's own clean-up (it must not).
 *
 * The key is read from the environment only. Never paste it into a chat, a
 * ticket or this file.
 */
import "dotenv/config";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { getEnv } from "@/lib/env";
import { mockImageProvider } from "@/lib/ai/providers/mock";
import { openaiImageProvider } from "@/lib/ai/providers/openai-image";
import { buildBrandContext } from "@/lib/context/context-builder";
import { keepOutside, regionMask } from "@/lib/visual/region";

async function main() {
  const env = getEnv();
  // The same choice the app makes (lib/ai selectImageProvider), without the app's request plumbing.
  if (env.AI_IMAGE_PROVIDER === "replicate") throw new Error("AI_IMAGE_PROVIDER=replicate is not built.");
  const provider = env.AI_IMAGE_PROVIDER === "openai"
    ? openaiImageProvider({ apiKey: env.OPENAI_API_KEY!, timeoutMs: env.AI_IMAGE_TIMEOUT_MS })
    : mockImageProvider;
  const model = env.AI_IMAGE_MODEL || "mock-image";
  console.log(`Provider: ${provider.name}, model: ${model}`);
  if (provider.name === "mock") console.log("This is the stand-in. Set AI_IMAGE_PROVIDER=openai, OPENAI_API_KEY and AI_IMAGE_MODEL to test the real model.");

  const context = buildBrandContext({
    brandProfile: { niche: "Leadership coaching", positioningStatement: "Helping first-time managers lead without burning out" },
    visualIdentity: { palette: ["#0f3d3e", "#f2ede4", "#e07a5f"], imageStyleNotes: "Natural light, real offices, calm colours" },
  });
  const out = mkdtempSync(join(tmpdir(), "huemen-pictures-"));

  let t = Date.now();
  const first = await provider.generate(
    { context, shape: "portrait", prompt: "A quiet desk by a window at dawn, a notebook open, a coffee cup, warm side light. No words, letters or logos.", negativePrompt: "stock-photo handshakes, glossy 3D, clip art" },
    model,
  );
  const drawMs = Date.now() - t;
  writeFileSync(join(out, "1-picture.png"), first.bytes);
  console.log(`Drew a picture in ${(drawMs / 1000).toFixed(1)}s (${first.width}x${first.height}).`);

  const { width, height } = await sharp(Buffer.from(first.bytes)).metadata();
  const box = { x: 0.55, y: 0.1, w: 0.35, h: 0.25 };
  const mask = await regionMask(box, width!, height!);
  t = Date.now();
  const edited = await provider.edit({ context, shape: "portrait", source: first.bytes, mask, prompt: "Change only the marked area: add a small green plant in a pot. Keep everything else exactly as it is." }, model);
  const editMs = Date.now() - t;
  const merged = await keepOutside(first.bytes, edited.bytes, box);
  writeFileSync(join(out, "2-model-output.png"), edited.bytes);
  writeFileSync(join(out, "3-after-huemen.png"), merged);

  // How much the model moved outside the box, and what is left after Huemen's clean-up.
  const raw = async (b: Uint8Array) => sharp(Buffer.from(b)).resize(width!, height!, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const [a, m, h] = await Promise.all([raw(first.bytes), raw(edited.bytes), raw(merged)]);
  let modelOutside = 0, afterOutside = 0, outside = 0;
  for (let y = 0; y < height!; y += 4) {
    for (let x = 0; x < width!; x += 4) {
      const inside = x >= box.x * width! && x < (box.x + box.w) * width! && y >= box.y * height! && y < (box.y + box.h) * height!;
      if (inside) continue;
      outside++;
      const i = (y * width! + x) * 4;
      const diff = (b: Buffer) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24;
      if (diff(m)) modelOutside++;
      if (diff(h)) afterOutside++;
    }
  }
  console.log(`Redrew the area in ${(editMs / 1000).toFixed(1)}s.`);
  console.log(`Outside the area: the model changed ${((modelOutside / outside) * 100).toFixed(1)}% of pixels; after Huemen's clean-up ${((afterOutside / outside) * 100).toFixed(1)}% (must be 0).`);
  console.log(`Pictures saved in ${out}`);
  if (afterOutside > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
