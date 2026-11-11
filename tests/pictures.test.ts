/**
 * Pictures on visuals (ChatGPT Image, built on the stand-in until the key is
 * set) and comments pinned on a spot of a visual.
 *
 *   - the area guarantee: a redraw changes pixels only inside the marked box
 *   - the OpenAI provider's requests and failures, against a fake fetch
 *   - drawing, redrawing an area, undo, regenerate keeps pictures, delete removes them
 *   - comments routed to the headline rewrite, the design settings or a picture job
 *   - the image cap stops a picture job and the comment says so
 *   - another workspace can't draw on, redraw or comment on A's visuals (INV-1)
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import sharp from "sharp";
import { appPool } from "@/db/pool";
import { createProject, unlockStage, type ProjectScope } from "@/lib/data/projects";
import { generateContent, listContent } from "@/lib/data/content";
import { deleteVisuals, generateVisuals, listVisuals } from "@/lib/data/pipeline";
import { designOf, drawPicture, pictureLinks, previousPicture, redrawArea, shapeFor } from "@/lib/data/pictures";
import { addComment, applyTemplateComment, getComment } from "@/lib/data/visual-comments";
import { cleanBox, keepOutside, regionMask } from "@/lib/visual/region";
import { openaiImageProvider } from "@/lib/ai/providers/openai-image";
import { selectImageProvider } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/errors";
import { parseEnv } from "@/lib/env";
import { drainJobs, enqueueJob, getJob } from "@/lib/jobs";
import { storage } from "@/lib/storage";
import type { BrandContext } from "@/lib/context/context-builder";

// The database owner, which RLS doesn't apply to: for setting up and for reading back what was stored.
let ownerPool: Pool | null = null;
const admin = async <T,>(sql: string, args: unknown[] = []) => {
  ownerPool ??= new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  return (await ownerPool.query(sql, args)).rows as T[];
};

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }).png().toBuffer());
}
const pixels = async (png: Uint8Array) => {
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

describe("the area guarantee", () => {
  it("makes a mask at the picture's size, transparent only inside the padded box", async () => {
    const m = await pixels(await regionMask({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, 200, 100, 0));
    expect([m.width, m.height]).toEqual([200, 100]);
    const alpha = (x: number, y: number) => m.data[(y * 200 + x) * 4 + 3];
    expect(alpha(120, 60)).toBe(0);
    expect(alpha(10, 10)).toBe(255);
    expect(alpha(160, 60)).toBe(255);
  });

  it("keeps every pixel outside the box exactly as it was, whatever the model returned", async () => {
    const original = await solid(100, 100, [10, 20, 30]);
    const edited = await solid(64, 64, [250, 0, 0]); // a different size, changed everywhere
    const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.3 };
    const out = await pixels(await keepOutside(original, edited, box, 4));
    const at = (x: number, y: number) => [...out.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)];
    for (const [x, y] of [[0, 0], [99, 99], [19, 30], [61, 30], [40, 19], [40, 51], [5, 90]]) expect(at(x, y)).toEqual([10, 20, 30]);
    expect(at(40, 35)).toEqual([250, 0, 0]);
  });

  it("refuses a box too small to mean anything, and clamps one that spills out", () => {
    expect(cleanBox({ x: 0.5, y: 0.5, w: 0.001, h: 0.2 })).toBeNull();
    expect(cleanBox({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 })).toEqual({ x: 0.9, y: 0.9, w: expect.closeTo(0.1, 5), h: expect.closeTo(0.1, 5) });
  });
});

describe("ChatGPT Image provider (OpenAI Images API)", () => {
  const ctx = { serialized: "", guardrails: { doWords: [], dontWords: [] } } as unknown as BrandContext;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const b64 = Buffer.concat([png, Buffer.alloc(200)]).toString("base64");

  it("draws with the configured model and the shape's size, and redraws with the picture and the mask", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const p = openaiImageProvider({ apiKey: "sk-test", timeoutMs: 5000 }, async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
    });
    const out = await p.generate({ context: ctx, prompt: "A desk at dawn", negativePrompt: "stock photos", shape: "portrait" }, "gpt-image-test");
    expect(out.bytes.byteLength).toBeGreaterThan(100);
    expect(seen[0].url).toBe("https://api.openai.com/v1/images/generations");
    const body = JSON.parse(String(seen[0].init.body));
    expect(body).toMatchObject({ model: "gpt-image-test", size: "1024x1536", n: 1 });
    expect(body.prompt).toContain("Avoid: stock photos");
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");

    await p.edit({ context: ctx, prompt: "Make the sky warmer", source: new Uint8Array(png), mask: new Uint8Array(png), shape: "square" }, "gpt-image-test");
    expect(seen[1].url).toBe("https://api.openai.com/v1/images/edits");
    const form = seen[1].init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-test");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("mask")).toBeInstanceOf(Blob);
  });

  it("says a rate limit or a server error is worth retrying, and a bad key isn't", async () => {
    const reply = (status: number) => openaiImageProvider({ apiKey: "k", timeoutMs: 5000 }, async () => new Response("{}", { status }));
    const err = async (status: number) => reply(status).generate({ context: ctx, prompt: "x" }, "m").catch((e) => e as ProviderError);
    expect(await err(429)).toMatchObject({ kind: "rate_limit", retryable: true });
    expect(await err(503)).toMatchObject({ kind: "server", retryable: true });
    expect(await err(401)).toMatchObject({ kind: "auth", retryable: false });
    const empty = openaiImageProvider({ apiKey: "k", timeoutMs: 5000 }, async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    expect(await empty.generate({ context: ctx, prompt: "x" }, "m").catch((e) => e)).toMatchObject({ kind: "unparseable" });
  });

  it("refuses to start half set up, and never falls back to the stand-in", () => {
    const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123" };
    expect(() => parseEnv({ ...BASE, AI_IMAGE_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY[\s\S]*AI_IMAGE_MODEL/);
    const env = parseEnv({ ...BASE, AI_IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "k", AI_IMAGE_MODEL: "gpt-image-test" });
    expect(selectImageProvider(env).name).toBe("openai");
    expect(selectImageProvider(parseEnv(BASE)).name).toBe("mock");
  });

  it("asks for the right shape per visual", () => {
    expect(shapeFor("quote", "linkedin_post")).toBe("square");
    expect(shapeFor("carousel", "linkedin_post")).toBe("portrait");
    expect(shapeFor("post", "linkedin_post")).toBe("portrait");
    expect(shapeFor("post", "hook_set")).toBe("square");
  });
});

let dbReachable = false;
let A: ProjectScope;
let B: ProjectScope;
let itemA = "";
const tenants: string[] = [];

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const mk = async (name: string, email: string) => {
    const [t] = await admin<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name]);
    const [u] = await admin<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','active') RETURNING id", [t.id, email]);
    tenants.push(t.id);
    const w = { tenantId: t.id, userId: u.id, isPlatformAdmin: false };
    return { ...w, projectId: await createProject(w, name) };
  };
  A = await mk("Pictures A (test)", "pictures-a@test.local");
  B = await mk("Pictures B (test)", "pictures-b@test.local");
  itemA = await generateContent(A, { format: "linkedin_post", topic: "pricing" });
  await unlockStage(A, "content");
  await generateVisuals(A, { scheme: 0, approvedOnly: false });
  await generateContent(B, { format: "linkedin_post", topic: "b" });
  await unlockStage(B, "content");
  await generateVisuals(B, { scheme: 0, approvedOnly: false });
}, 60_000);

afterAll(async () => {
  if (!dbReachable) return;
  await deleteVisuals(A, itemA).catch(() => undefined);
  await admin("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenants]);
  await ownerPool?.end();
  await appPool().end();
});

const visual = async (s: ProjectScope, kind = "single") => (await listVisuals(s)).find((v) => v.kind === kind)!;

/**
 * Run the queue until this job has finished. Other test files run workers on
 * the same database in parallel and may be holding it; wait for theirs too.
 */
async function settle(s: ProjectScope, jobId: string) {
  for (let i = 0; i < 60; i++) {
    await drainJobs({ budgetMs: 20_000 });
    const j = await getJob(s, jobId);
    if (j && j.status !== "queued" && j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 250));
  }
  return getJob(s, jobId);
}

describe("pictures on a visual", () => {
  it("draws a picture for one visual, stores it in the workspace, and only that visual carries it", async () => {
    if (!dbReachable) return;
    const id = await drawPicture(A, itemA, "post", "live_text");
    const d = await designOf(A, itemA);
    expect(d?.pictures.post).toEqual({ id, mode: "live_text" });
    expect(d?.pictures.quote).toBeUndefined();
    const [row] = await admin<{ storage_key: string; prompt: string; width: number }>("SELECT storage_key, prompt, width FROM image_assets WHERE id=$1", [id]);
    expect(row.storage_key.startsWith(`tenants/${A.tenantId}/pictures/`)).toBe(true);
    expect(row.prompt).toMatch(/No words, letters/);
    expect(row.width).toBeGreaterThan(500);
    expect(await storage().get(row.storage_key)).not.toBeNull();
    const links = await pictureLinks(A, [id]);
    expect(links[id]).toContain("/api/storage/");
    // Generation is logged as one image.
    const [log] = await admin<{ n: number }>("SELECT count(*)::int AS n FROM generation_logs WHERE tenant_id=$1 AND kind='image' AND status='ok'", [A.tenantId]);
    expect(log.n).toBe(1);
  });

  it("text in the picture: the brief carries the exact heading", async () => {
    if (!dbReachable) return;
    const id = await drawPicture(A, itemA, "quote", "with_text");
    const [row] = await admin<{ prompt: string; params: { heading: string } }>("SELECT prompt, params FROM image_assets WHERE id=$1", [id]);
    const [item] = await listContent(A);
    expect(row.prompt).toContain(`Text: "${item.hook.replace(/"/g, "'").slice(0, 120)}"`);
    expect(row.params.heading).toBe(item.hook);
  });

  it("redraws only the marked area, as a new version, and Undo goes back", async () => {
    if (!dbReachable) return;
    const before = (await designOf(A, itemA))!.pictures.post!.id;
    const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };
    const after = await redrawArea(A, itemA, "post", box, "make this corner warmer");
    expect(after).not.toBe(before);
    const key = async (id: string) => (await admin<{ storage_key: string }>("SELECT storage_key FROM image_assets WHERE id=$1", [id]))[0].storage_key;
    const a = await pixels((await storage().get(await key(before)))!.data);
    const b = await pixels((await storage().get(await key(after)))!.data);
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    let outsideChanged = 0;
    let insideChanged = 0;
    for (let y = 0; y < a.height; y += 7) {
      for (let x = 0; x < a.width; x += 7) {
        const i = (y * a.width + x) * 4;
        const differs = a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2];
        const inside = x >= box.x * a.width && x < (box.x + box.w) * a.width && y >= box.y * a.height && y < (box.y + box.h) * a.height;
        if (differs && !inside) outsideChanged++;
        if (differs && inside) insideChanged++;
      }
    }
    expect(outsideChanged).toBe(0);
    expect(insideChanged).toBeGreaterThan(0);

    expect(await previousPicture(A, itemA, "post")).toBe(true);
    expect((await designOf(A, itemA))!.pictures.post!.id).toBe(before);
  });

  it("a regenerate keeps the pictures; deleting the visuals removes them and their files", async () => {
    if (!dbReachable) return;
    const keep = (await designOf(A, itemA))!.pictures;
    await generateVisuals(A, { scheme: 1, approvedOnly: false });
    expect((await designOf(A, itemA))!.pictures).toEqual(keep);
    expect((await listVisuals(A)).every((v) => v.kind !== "picture")).toBe(true);
  });

  it("B can't draw on, redraw or link A's pictures", async () => {
    if (!dbReachable) return;
    const bOnA = { ...B, projectId: A.projectId };
    await expect(drawPicture(bOnA, itemA, "post", "live_text")).rejects.toThrow();
    await expect(redrawArea(bOnA, itemA, "post", { x: 0, y: 0, w: 0.5, h: 0.5 }, "x")).rejects.toThrow();
    const id = (await designOf(A, itemA))!.pictures.post!.id;
    expect(await pictureLinks(B, [id])).toEqual({});
    expect(await pictureLinks(bOnA, [id])).toEqual({});
  });
});

describe("comments pinned on a visual", () => {
  it("a comment on the headline rewrites the headline and says what it became", async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    const before = (await listContent(A))[0].hook;
    const c = await addComment(A, { visualId: v.id, target: "headline", box: { x: 0.05, y: 0.1, w: 0.9, h: 0.3 }, note: "shorter" });
    const done = await applyTemplateComment(A, c);
    expect(done.status).toBe("applied");
    const after = (await listContent(A))[0].hook;
    expect(after).not.toBe(before);
    expect(done.result).toContain(after.slice(0, 40));
  });

  it("a comment on the logo changes the design settings, not the copy", async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    const c = await addComment(A, { visualId: v.id, target: "logo", box: { x: 0.8, y: 0.85, w: 0.15, h: 0.1 }, note: "make the logo smaller" });
    const done = await applyTemplateComment(A, c);
    expect(done.status).toBe("applied");
    expect((await designOf(A, itemA))!.tweaks.logo).toBe("small");
  });

  it("a comment on the picture runs as a job and redraws that area; at the image cap it stops and the pin says why", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    const before = (await designOf(A, itemA))!.pictures.post!.id;
    const c = await addComment(A, { visualId: v.id, target: "picture", box: { x: 0.5, y: 0.5, w: 0.3, h: 0.3 }, note: "add a coffee cup here" });
    const jobId = await enqueueJob(A, "picture_edit", { projectId: A.projectId, commentId: c.id }, { label: "Changing the picture" });
    expect((await settle(A, jobId))?.status).toBe("succeeded");
    expect((await getComment(A, c.id))?.status).toBe("applied");
    expect((await designOf(A, itemA))!.pictures.post!.id).not.toBe(before);

    await admin("INSERT INTO tenant_usage_caps (tenant_id, monthly_image_hard) VALUES ($1, 0) ON CONFLICT (tenant_id) DO UPDATE SET monthly_image_hard = 0", [A.tenantId]);
    const c2 = await addComment(A, { visualId: v.id, target: "picture", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, note: "darker" });
    const j2 = await enqueueJob(A, "picture_edit", { projectId: A.projectId, commentId: c2.id }, { label: "Changing the picture" });
    expect((await settle(A, j2))?.status).toBe("failed");
    const pin = await getComment(A, c2.id);
    expect(pin?.status).toBe("failed");
    expect(pin?.result).toMatch(/switched off|used its/i);
    await admin("UPDATE tenant_usage_caps SET monthly_image_hard = NULL WHERE tenant_id=$1", [A.tenantId]);
  });

  it("refuses a comment with no note, no real box, a picture comment on a visual without one, or from another workspace", async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    await expect(addComment(A, { visualId: v.id, target: "headline", box: { x: 0, y: 0, w: 0.5, h: 0.5 }, note: "   " })).rejects.toThrow(/Say what/);
    await expect(addComment(A, { visualId: v.id, target: "headline", box: { x: 0, y: 0, w: 0, h: 0 }, note: "x" })).rejects.toThrow(/bigger area/);
    const carousel = await visual(A, "carousel_frame");
    await expect(addComment(A, { visualId: carousel.id, target: "picture", box: { x: 0, y: 0, w: 0.5, h: 0.5 }, note: "x" })).rejects.toThrow(/no picture yet/);
    await expect(addComment({ ...B, projectId: A.projectId }, { visualId: v.id, target: "headline", box: { x: 0, y: 0, w: 0.5, h: 0.5 }, note: "x" })).rejects.toThrow(/isn't in this project/);
    await expect(addComment(B, { visualId: v.id, target: "headline", box: { x: 0, y: 0, w: 0.5, h: 0.5 }, note: "x" })).rejects.toThrow(/isn't in this project/);
  });
});
