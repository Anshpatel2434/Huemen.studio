/**
 * Real-model check of the writing rules (2026-11-17 round): a draft with a
 * binding pillar and angle, a steer, a draft where no offer fits, and the
 * judge and rewrite on hype copy. Each call waits 35 seconds after the last
 * (the free tier is shared). Works on one workspace's own data and leaves
 * the pieces it writes in a project named below.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json src/ai-smoke/writing-check.ts <tenantId> <userId> [steps]
 */
import "dotenv/config";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const odd = (t: string) => [...t.matchAll(/[‐‑  —]/g)].map((m) => `U+${m[0].charCodeAt(0).toString(16).toUpperCase()}`);

async function main() {
  const [tenantId, userId, stepsArg] = process.argv.slice(2);
  if (!tenantId || !userId) throw new Error("usage: writing-check.ts <tenantId> <userId> [steps]");
  const steps = new Set((stepsArg ?? "draft,steer,nooffer,judge,rewrite").split(","));
  const { startPiece } = await import("@/lib/data/create");
  const { generateContent, listContent, regenerateWithSteer } = await import("@/lib/data/content");
  const { checkText, judgeText, rewriteText } = await import("@/lib/data/check");
  const { withLineFindings } = await import("@/lib/voice/judge");
  const { listPillars } = await import("@/lib/data/planning");
  const { loadBrandContext } = await import("@/lib/context/context-loader");
  const { withTenantSession } = await import("@/db/session");
  const { appPool } = await import("@/db/pool");

  const ws = { tenantId, userId, isPlatformAdmin: false };
  const pillars = await listPillars(ws);
  const pick = (name: string) => pillars.find((p) => p.name === name) ?? pillars[0];
  const ctx = await loadBrandContext(ws, "en", "linkedin", "write");
  console.log("measured length:", ctx.writing.lengthWords, "noEmDash:", ctx.writing.noEmDash);
  let calls = 0;
  const pace = async () => { if (calls++ > 0) await wait(35_000); };

  const show = async (label: string, scope: { tenantId: string; userId: string; isPlatformAdmin: boolean; projectId: string }, id: string) => {
    const item = (await listContent(scope)).find((i) => i.id === id)!;
    const text = [item.hook, item.body, item.cta].filter(Boolean).join("\n\n");
    const check = await checkText(scope, text, "linkedin", { copyCheck: true });
    console.log(`\n===== ${label} (${words(text)} words, score ${check.score} ${check.band}, placeholders ${item.placeholders.length}, odd chars ${JSON.stringify(odd(text))})`);
    console.log(`HOOK: ${item.hook}\nBODY: ${item.body}\nCTA: ${item.cta}`);
    console.log("findings:", check.issues.map((i) => i.message).join(" | ") || "none");
    const logs = await withTenantSession(scope, async (c) => (await c.query("SELECT count(*)::int AS n FROM generation_logs WHERE content_item_id = $1", [id])).rows[0].n);
    console.log("generation_logs rows for this piece:", logs);
    return item;
  };

  let scope1: { tenantId: string; userId: string; isPlatformAdmin: boolean; projectId: string } | null = null;
  let id1 = "";
  if (steps.has("draft")) {
    const pillar = pick("Contrarian takes");
    const pid = await startPiece(ws, { topic: "Annual plans as a cash-flow tool", format: "linkedin_post", pillarId: pillar?.id ?? null, angle: "A story from the work" });
    scope1 = { ...ws, projectId: pid };
    await pace();
    id1 = await generateContent(scope1, { format: "linkedin_post", topic: "Annual plans as a cash-flow tool", pillarId: pillar?.id ?? null, angle: "A story from the work" });
    await show("DRAFT: pillar Contrarian takes, angle A story from the work", scope1, id1);
  }
  if (steps.has("steer") && scope1) {
    await pace();
    await regenerateWithSteer(scope1, id1, "Shorter");
    await show("STEER: Shorter", scope1, id1);
  }
  if (steps.has("nooffer")) {
    const pillar = pick("Origin story");
    const pid = await startPiece(ws, { topic: "Why I left agency work to work with founders one at a time", format: "linkedin_post", pillarId: pillar?.id ?? null, angle: "What the work has taught me" });
    const scope = { ...ws, projectId: pid };
    await pace();
    const id = await generateContent(scope, { format: "linkedin_post", topic: "Why I left agency work to work with founders one at a time", pillarId: pillar?.id ?? null, angle: "What the work has taught me" });
    await show("DRAFT: pillar Origin story (no offer fits)", scope, id);
  }
  const hype = [
    "In today's fast-paced world, pricing is a game-changing lever!!!",
    "We are thrilled to announce our revolutionary new framework!",
    "It can't fail, add features right up to launch, it's risky but worth it!",
    "Unlock your true potential today! #pricing #growth #founders",
  ].join("\n");
  if (steps.has("judge")) {
    const check = await checkText(ws, hype, "linkedin");
    await pace();
    const findings = await judgeText(ws, hype, "linkedin");
    const verdict = withLineFindings(check, findings.filter((f) => f.verdict !== "on"));
    console.log(`\n===== CHECK on hype copy: code score ${check.score} ${check.band}; with line findings ${verdict.score} ${verdict.band}`);
    console.log("code findings:", check.issues.map((i) => `${i.message}${i.excerpt ? ` [${i.excerpt}]` : ""}`).join(" | "));
    for (const f of findings) console.log(`- [${f.verdict}] "${f.line}"\n    quote: "${f.quote}"\n    why: ${f.why}\n    fix: ${f.remove ? "(cut the line)" : f.fix || "(no usable fix)"}`);
  }
  if (steps.has("rewrite")) {
    await pace();
    const text = await rewriteText(ws, hype, "linkedin");
    const check = await checkText(ws, text, "linkedin");
    console.log(`\n===== REWRITE in my voice (${words(text)} words, score ${check.score} ${check.band}, odd chars ${JSON.stringify(odd(text))})\n${text}`);
    console.log("findings:", check.issues.map((i) => i.message).join(" | ") || "none");
  }
  console.log(`\nmodel calls made: ${calls}`);
  await appPool().end();
}

main().catch((e) => {
  console.error("FAILED:", e?.kind ?? "", e?.message ?? e);
  process.exit(1);
});
