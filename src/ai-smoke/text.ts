/**
 * Real-key smoke test for the text provider: one structured call (two draft
 * variants), one task-shaped structured call and one streamed draft, with
 * the time and tokens of each. Reads AI_TEXT_PROVIDER and the models from
 * .env; the stand-in answers too, so it runs without a key.
 *
 *   npm run smoke:text
 *
 * The key is read from the environment only (.env, never committed).
 */
import "dotenv/config";
import { z } from "zod";

async function main() {
  const { selectTextProvider, resolveTextModel } = await import("@/lib/ai");
  const { getEnv } = await import("@/lib/env");
  const env = getEnv();
  const provider = selectTextProvider(env);
  const strong = resolveTextModel(env, "strong");
  const cheap = resolveTextModel(env, "cheap");
  console.log(`provider ${provider.name}, strong ${strong}, cheap ${cheap}\n`);

  const prompt = {
    system: "You write LinkedIn posts for a brand strategist who helps founders in the UK and India sharpen their positioning. Plain, confident, a little cheeky. No hashtags, no emojis.",
    user: "Write a short LinkedIn post (under 90 words) about why most founders describe what they do instead of who it is for.",
  };

  let t = Date.now();
  const gen = await provider.generate({ prompt, variants: 2 } as never, strong, { effort: env.AI_TEXT_EFFORT_STRONG });
  console.log(`generate: ${gen.variants.length} variants in ${Date.now() - t} ms (${gen.tokensIn} in / ${gen.tokensOut} out, ${gen.model})`);
  gen.variants.forEach((v, i) => console.log(`--- variant ${i + 1}\n${v}\n`));

  t = Date.now();
  const Hooks = z.object({ hooks: z.array(z.string()).min(3), pillar: z.string() });
  const st = await provider.structured({ prompt: { ...prompt, user: "Give three opening lines for that post and name the content pillar it belongs to." } } as never, cheap, Hooks, { effort: env.AI_TEXT_EFFORT_CHEAP });
  console.log(`structured: in ${Date.now() - t} ms (${st.model})`, JSON.stringify(st.data, null, 2), "\n");

  t = Date.now();
  let first = 0;
  let chunks = 0;
  for await (const ev of provider.stream({ prompt } as never, strong, { effort: env.AI_TEXT_EFFORT_STRONG })) {
    if (ev.type === "delta") {
      chunks++;
      if (!first) first = Date.now() - t;
    } else console.log(`stream: first words after ${first} ms, ${chunks} chunks, done in ${Date.now() - t} ms (${ev.tokensIn} in / ${ev.tokensOut} out)\n${ev.text}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.kind ?? "", e?.message ?? e);
  process.exit(1);
});
