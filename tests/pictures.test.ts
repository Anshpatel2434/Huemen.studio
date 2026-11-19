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
import { describe, it, expect, beforeAll, afterAll, vi, onTestFinished } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { appPool } from "@/db/pool";
import { createProject, unlockStage, type ProjectScope } from "@/lib/data/projects";
import { generateContent, listContent, patchContent } from "@/lib/data/content";
import { deleteVisuals, generateVisuals, listVisuals } from "@/lib/data/pipeline";
import {
  colourLines, cutOutPicture, cutOutRefusal, CUTOUT_LOCKED, designOf, drawPicture, pictureInstructions, pictureLinks, pictureVersions, previousPicture, redrawArea,
  EXTEND_TRIES, resizeKind, resizePicture, selectPictureVersion, shapeFor,
} from "@/lib/data/pictures";
import { addComment, addPictureComments, applyTemplateComment, failedComment, getComment, setCommentsJob } from "@/lib/data/visual-comments";
import { mockImageProvider } from "@/lib/ai/providers/mock";
import { tenantKey } from "@/lib/storage";
import { approveAgain, revertCopy } from "@/lib/data/visual-copy";
import { changeInside, cleanBox, keepOutside, regionMask, seamFeather, SEAM_MAX, SEAM_MIN, strokeMask } from "@/lib/visual/region";
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

  it("blends a big area's edge wider (scaled to the area), and still keeps every pixel outside it", async () => {
    expect(seamFeather(100, 100)).toBe(SEAM_MIN);
    expect(seamFeather(800, 600)).toBe(30);
    expect(seamFeather(4000, 4000)).toBe(SEAM_MAX);
    const original = await solid(1000, 1000, [10, 20, 30]);
    const edited = await solid(1000, 1000, [250, 0, 0]);
    const box = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }; // 600 px: a 30 px blend
    const out = await pixels(await keepOutside(original, edited, box));
    const red = (x: number, y: number) => out.data[(y * 1000 + x) * 4];
    for (const [x, y] of [[199, 500], [500, 199], [800, 500], [500, 800], [0, 0], [999, 999]]) expect(red(x, y)).toBe(10);
    // 15 px in: about half way, where a fixed 12 px edge would already be fully the edit.
    expect(red(214, 500)).toBeGreaterThan(80);
    expect(red(214, 500)).toBeLessThan(180);
    expect(red(240, 500)).toBe(250);
    // How much a brushed area changed: none for the same picture, plenty for a new colour, nothing counted outside the brush.
    const brush = await strokeMask([{ w: 0.06, pts: [[0.3, 0.8], [0.6, 0.8]] }], 1000, 1000);
    expect(await changeInside(original, original, brush)).toBe(0);
    expect(await changeInside(original, edited, brush)).toBeGreaterThan(0.3);
    expect(await changeInside(original, await keepOutside(original, edited, { x: 0, y: 0, w: 0.2, h: 0.2 }), brush)).toBe(0);
    // The fade only rises going inwards.
    let last = 0;
    for (let x = 200; x < 240; x++) {
      expect(red(x, 500)).toBeGreaterThanOrEqual(last);
      last = red(x, 500);
    }
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
 * Run the queue (this file's workspaces only) until this job has finished.
 */
async function settle(s: ProjectScope, jobId: string) {
  for (let i = 0; i < 60; i++) {
    await drainJobs({ budgetMs: 20_000, onlyTenants: tenants });
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
    // The drawn heading is the stored heading in full (M3): it is never cut to a length.
    expect(row.prompt).toContain(`Text: "${item.hook.replace(/"/g, "'")}"`);
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

describe("picture versions, one change at a time, try again, undo", () => {
  it("two area changes sent together run one after the other: the second starts from the first's result, and neither is lost", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const start = (await designOf(A, itemA))!.pictures.post!.id;
    const one = { x: 0.05, y: 0.05, w: 0.2, h: 0.2 };
    const two = { x: 0.65, y: 0.65, w: 0.2, h: 0.2 };
    const [a, b] = await Promise.all([
      redrawArea(A, itemA, "post", one, "warmer here"),
      redrawArea(A, itemA, "post", two, "cooler here"),
    ]);
    const rows = await admin<{ id: string; parent_id: string }>("SELECT id, parent_id FROM image_assets WHERE id = ANY($1::uuid[])", [[a, b]]);
    const parentOf = new Map(rows.map((r) => [r.id, r.parent_id]));
    // A chain, not two branches off the same version: start <- first <- second.
    const first = [a, b].find((id) => parentOf.get(id) === start)!;
    const second = [a, b].find((id) => id !== first)!;
    expect(first).toBeTruthy();
    expect(parentOf.get(second)).toBe(first);
    expect((await designOf(A, itemA))!.pictures.post!.id).toBe(second);

    // The picture in use carries BOTH changes.
    const key = async (id: string) => (await admin<{ storage_key: string }>("SELECT storage_key FROM image_assets WHERE id=$1", [id]))[0].storage_key;
    const was = await pixels((await storage().get(await key(start)))!.data);
    const now = await pixels((await storage().get(await key(second)))!.data);
    const changedIn = (box: { x: number; y: number; w: number; h: number }) => {
      let n = 0;
      for (let y = Math.floor(box.y * was.height); y < (box.y + box.h) * was.height; y += 5) {
        for (let x = Math.floor(box.x * was.width); x < (box.x + box.w) * was.width; x += 5) {
          const i = (y * was.width + x) * 4;
          if (was.data[i] !== now.data[i] || was.data[i + 1] !== now.data[i + 1] || was.data[i + 2] !== now.data[i + 2]) n++;
        }
      }
      return n;
    };
    expect(changedIn(one)).toBeGreaterThan(0);
    expect(changedIn(two)).toBeGreaterThan(0);
  });

  it("lists every version newest first with the heading it was drawn with, an earlier one can be put back, and B sees none", async () => {
    if (!dbReachable) return;
    const all = await pictureVersions(A);
    const post = all.filter((v) => v.artboard === "post");
    expect(post.length).toBeGreaterThanOrEqual(4);
    expect(post.map((v) => v.createdAt)).toEqual([...post.map((v) => v.createdAt)].sort().reverse());
    expect(post[0].id).toBe((await designOf(A, itemA))!.pictures.post!.id);
    expect(post.every((v) => v.url.includes("/api/storage/") && v.contentItemId === itemA)).toBe(true);
    // A fresh draw has no parent; an area change points at the version it was made from.
    expect(post.at(-1)!.parentId).toBeNull();
    expect(post[0].parentId).toBe(post[1].id);

    // The quote card's picture has the heading drawn in; the headline was rewritten since, so it is stale.
    const quote = all.find((v) => v.artboard === "quote")!;
    expect(quote.mode).toBe("with_text");
    expect(quote.heading).toBeTruthy();
    expect(quote.heading).not.toBe((await listContent(A))[0].hook);

    const oldest = post.at(-1)!.id;
    expect(await selectPictureVersion(A, itemA, "post", oldest)).toBe(true);
    expect((await designOf(A, itemA))!.pictures.post).toEqual({ id: oldest, mode: "live_text" });
    // Not a version of another visual, and not from another workspace.
    expect(await selectPictureVersion(A, itemA, "post", quote.id)).toBe(false);
    expect(await selectPictureVersion({ ...B, projectId: A.projectId }, itemA, "post", post[0].id)).toBe(false);
    expect(await pictureVersions(B)).toEqual([]);
    expect(await pictureVersions({ ...B, projectId: A.projectId })).toEqual([]);
  });

  it("Try again runs a failed comment again, and never one that went through", async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    await admin("UPDATE content_items SET cta='' WHERE id=$1", [itemA]);
    const c = await addComment(A, { visualId: v.id, target: "cta", box: { x: 0.1, y: 0.8, w: 0.5, h: 0.1 }, note: "more direct" });
    const failed = await applyTemplateComment(A, c);
    expect(failed.status).toBe("failed");
    expect(failed.result).toMatch(/no text there/);

    await admin("UPDATE content_items SET cta='Book a call with me this week.' WHERE id=$1", [itemA]);
    const again = await failedComment(A, c.id);
    expect(again.id).toBe(c.id);
    expect(again.artboard).toBe("post");
    const done = await applyTemplateComment(A, again);
    expect(done.status).toBe("applied");
    expect((await listContent(A))[0].cta).not.toBe("Book a call with me this week.");

    await expect(failedComment(A, c.id)).rejects.toThrow(/already went through/);
    await expect(failedComment(B, c.id)).rejects.toThrow(/isn't there/);
    await expect(failedComment({ ...B, projectId: A.projectId }, c.id)).rejects.toThrow(/isn't there/);
    expect(done.resultPictureId).toBeNull();
  });

  it("a picture comment remembers the version it made, so the board can tell when it was undone", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    const c = await addComment(A, { visualId: v.id, target: "picture", box: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, note: "a plant here" });
    const jobId = await enqueueJob(A, "picture_edit", { projectId: A.projectId, commentId: c.id }, { label: "Changing the picture" });
    expect((await settle(A, jobId))?.status).toBe("succeeded");
    const made = (await designOf(A, itemA))!.pictures.post!.id;
    expect((await getComment(A, c.id))?.resultPictureId).toBe(made);
    // Undo: the visual is back on the version before; the comment still says which version it made.
    expect(await previousPicture(A, itemA, "post")).toBe(true);
    expect((await designOf(A, itemA))!.pictures.post!.id).not.toBe(made);
    expect((await getComment(A, c.id))?.resultPictureId).toBe(made);
  });

  it("undoing a copy edit puts the words and the status back; a stale undo changes nothing", async () => {
    if (!dbReachable) return;
    await admin("UPDATE content_items SET status='draft' WHERE id=$1", [itemA]);
    const before = (await listContent(A))[0];
    await patchContent(A, itemA, { hook: "A new heading typed on the visual" }, { hook: before.hook });
    expect((await listContent(A))[0].status).toBe("edited");

    // Another tab changed it since: the undo is refused and nothing moves.
    await expect(revertCopy(A, itemA, { hook: before.hook }, { hook: "not what is there" }, "draft")).rejects.toThrow();
    expect((await listContent(A))[0].status).toBe("edited");

    await revertCopy(A, itemA, { hook: before.hook }, { hook: "A new heading typed on the visual" }, "draft");
    const after = (await listContent(A))[0];
    expect(after.hook).toBe(before.hook);
    expect(after.status).toBe("draft");

    // A piece that was already edited stays edited, and a made-up status is ignored.
    await patchContent(A, itemA, { hook: "Second edit" });
    await revertCopy(A, itemA, { hook: before.hook }, null, "published");
    expect((await listContent(A))[0].status).toBe("edited");
    // Another workspace can't revert A's piece.
    await revertCopy({ ...B, projectId: A.projectId }, itemA, { hook: "B was here" }, null, "draft");
    expect((await listContent(A))[0].hook).toBe(before.hook);
  });

  it("Approve again approves only a piece that still says edited, and only in its own workspace", async () => {
    if (!dbReachable) return;
    await admin("UPDATE content_items SET status='approved' WHERE id=$1", [itemA]);
    await patchContent(A, itemA, { hook: "Heading changed on an approved visual" });
    expect((await listContent(A))[0].status).toBe("edited");
    // Another workspace can't approve A's piece.
    expect(await approveAgain({ ...B, projectId: A.projectId }, itemA)).toBeNull();
    expect((await listContent(A))[0].status).toBe("edited");
    expect(await approveAgain(A, itemA)).toEqual({ hook: "Heading changed on an approved visual" });
    expect((await listContent(A))[0].status).toBe("approved");
    // Already approved (or moved on since): nothing to do.
    expect(await approveAgain(A, itemA)).toBeNull();
  });
});

describe("the picture brief's rules (pure)", () => {
  it("the picture is told no codes, no screens and no logos, in either mode", () => {
    const live = pictureInstructions("live_text", "Copying kills uniqueness");
    expect(live).toMatch(/^No words, letters, numbers, hex codes or logos/);
    expect(live).toMatch(/No hex codes, colour codes, UI, app or chat screens, and no logos/);
    const drawn = pictureInstructions("with_text", "Copying kills uniqueness");
    expect(drawn).toContain('Text: "Copying kills uniqueness"');
    expect(drawn).toMatch(/No other words, letters, numbers or codes/);
    expect(drawn).toMatch(/No hex codes/);
  });

  it("the brief gets the brand palette and this visual's colours as hex, and says when there is none", () => {
    const scheme = { name: "Scheme 1", bg: "#f6f1e9", fg: "#141414", accent: "#1f4d3a" };
    expect(colourLines(["#f6f1e9", "#1f4d3a", "#141414"], scheme)).toEqual([
      "Brand palette (hex): #F6F1E9, #1F4D3A, #141414",
      "This visual's colours (hex): ground #F6F1E9, ink #141414, accent #1F4D3A.",
    ]);
    expect(colourLines([], null)).toEqual(["Brand palette: none set, so the house colours stand in."]);
  });
});

// ---- the picture tools (2026-11-18) -------------------------------------------------------

/** Put a picture of our own on a visual, as its current version (a known picture makes the checks exact). */
async function plant(s: ProjectScope, item: string, artboard: "post" | "quote", png: Uint8Array, mode: "live_text" | "with_text" = "live_text") {
  const key = tenantKey(s.tenantId!, "pictures", `${randomUUID()}.png`);
  await storage().put(key, png, "image/png");
  const { width, height } = await sharp(Buffer.from(png)).metadata();
  const [row] = await admin<{ id: string }>(
    `INSERT INTO image_assets (tenant_id, project_id, content_item_id, kind, prompt, model, params, aspect_ratio, storage_key, width, height, status, is_current)
     VALUES ($1,$2,$3,'picture','A planted test picture','test',$4,$5,$6,$7,$8,'ready',false) RETURNING id`,
    [s.tenantId, s.projectId, item, JSON.stringify({ artboard, mode, shape: "portrait", heading: mode === "with_text" ? "A heading" : null, op: "draw" }), `${width}:${height}`, key, width, height],
  );
  expect(await selectPictureVersion(s, item, artboard, row.id)).toBe(true);
  return row.id;
}

const pictureRowOf = async (id: string) =>
  (await admin<{ parent_id: string | null; params: { op?: string; cutout?: boolean; shape?: string }; storage_key: string; width: number; height: number }>(
    "SELECT parent_id, params, storage_key, width, height FROM image_assets WHERE id=$1", [id],
  ))[0];
const fileOf = async (id: string) => pixels((await storage().get((await pictureRowOf(id)).storage_key))!.data);
const imageLogs = async (s: ProjectScope) =>
  (await admin<{ n: number }>("SELECT count(*)::int AS n FROM generation_logs WHERE tenant_id=$1 AND kind='image'", [s.tenantId]))[0].n;
const setImageCap = (s: ProjectScope, cap: number | null) =>
  admin("INSERT INTO tenant_usage_caps (tenant_id, monthly_image_hard) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET monthly_image_hard = $2", [s.tenantId, cap]);

/** What sendPictureCommentsAction does after it has checked the session: keep the pins, queue ONE job, point the pins at it. */
async function send(s: ProjectScope, visualId: string, pins: unknown[]) {
  const { comments } = await addPictureComments(s, visualId, pins);
  const ids = comments.map((c) => c.id);
  const jobId = await enqueueJob(s, "picture_edit", { projectId: s.projectId, commentIds: ids, commentId: ids[0] }, { label: `Changing the picture (${ids.length} changes)`, maxAttempts: 3 });
  await setCommentsJob(s, ids, jobId);
  return { ids, jobId };
}
const jobsOf = async (s: ProjectScope) => (await admin<{ n: number }>("SELECT count(*)::int AS n FROM jobs WHERE tenant_id=$1 AND kind='picture_edit'", [s.tenantId]))[0].n;

const PIN_BOX = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
const ERASE_STROKES = [{ w: 0.06, pts: [[0.3, 0.8], [0.6, 0.8]] as [number, number][] }];
const threePins = () => [
  { kind: "comment", box: PIN_BOX, area: { x: 0.05, y: 0.05, w: 0.2, h: 0.15 }, note: "a plant here" },
  { kind: "markup", box: PIN_BOX, area: null, strokes: [{ w: 0.008, pts: [[0.6, 0.3], [0.8, 0.35], [0.7, 0.45]] }], note: "make what I circled warmer" },
  { kind: "erase", box: PIN_BOX, area: null, strokes: ERASE_STROKES, note: "" },
];
const SUBJECT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#b0c4de"/><rect x="100" y="125" width="200" height="250" fill="#8b0000"/></svg>';
const subjectPng = async () => new Uint8Array(await sharp(Buffer.from(SUBJECT_SVG)).png().toBuffer());

type Edit = typeof mockImageProvider.edit;
/**
 * The stand-in's erase fills from the colour around the brush; on a smooth
 * stand-in picture that is too little change to count as removed
 * (ERASE_MIN_CHANGE). These tests stand for a model that did remove
 * something, so the brushed pixels come back plainly changed.
 */
const visibleErase = (edit: Edit): Edit => async (req, model) => {
  const out = await edit(req, model);
  if (req.intent !== "erase") return out;
  const img = await pixels(out.bytes);
  const src = await pixels(req.source);
  const m = await pixels(req.mask);
  for (let i = 0; i < img.width * img.height; i++) {
    if (m.data[i * 4 + 3] >= 128) continue;
    // Half the range away from what was there, whatever the colour.
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = src.data[i * 4 + c] ^ 0x80;
  }
  const png = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
  return { ...out, bytes: new Uint8Array(png) };
};

describe("picture tools: several pins, one Send", () => {
  it("a 3-pin Send is ONE job that applies the pins in order, each from the one before, and keeps each pin's area on its row", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const real = visibleErase(mockImageProvider.edit.bind(mockImageProvider));
    const spy = vi.spyOn(mockImageProvider, "edit").mockImplementation(real);
    onTestFinished(() => spy.mockRestore());
    const v = await visual(A);
    const start = (await designOf(A, itemA))!.pictures.post!.id;
    const jobsBefore = await jobsOf(A);
    const logsBefore = await imageLogs(A);
    const { ids, jobId } = await send(A, v.id, threePins());
    expect(await jobsOf(A)).toBe(jobsBefore + 1);
    // Stored as asked: the kind, the picture's own area, the strokes; Erase writes its own note.
    const pins = await Promise.all(ids.map((id) => getComment(A, id)));
    expect(pins.map((p) => [p!.kind, p!.status, p!.jobId])).toEqual([["comment", "working", jobId], ["markup", "working", jobId], ["erase", "working", jobId]]);
    expect(pins[0]!.area).toEqual({ x: expect.closeTo(0.05, 5), y: expect.closeTo(0.05, 5), w: expect.closeTo(0.2, 5), h: expect.closeTo(0.15, 5) });
    expect(pins[1]!.strokes).toHaveLength(1);
    expect(pins[2]!.note).toBe("Erase what is brushed over");

    const job = await settle(A, jobId);
    expect(job?.status).toBe("succeeded");
    const done = await Promise.all(ids.map((id) => getComment(A, id)));
    expect(done.map((p) => p!.status)).toEqual(["applied", "applied", "applied"]);
    const made = done.map((p) => p!.resultPictureId!);
    // A chain: start <- comment <- markup <- erase, and the visual shows the last.
    const rows = await Promise.all(made.map(pictureRowOf));
    expect(rows.map((r) => r.parent_id)).toEqual([start, made[0], made[1]]);
    expect(rows.map((r) => r.params.op)).toEqual(["area", "markup", "erase"]);
    expect((job!.result as { pictureId: string }).pictureId).toBe(made[2]);
    expect((await designOf(A, itemA))!.pictures.post!.id).toBe(made[2]);
    // One picture charge per pin.
    expect(await imageLogs(A)).toBe(logsBefore + 3);
    // The versions strip can say how each came to be.
    expect((await pictureVersions(A)).find((x) => x.id === made[1])).toMatchObject({ op: "markup", cutout: false, width: 1024, height: 1536 });

    // Erase changed only brushed pixels.
    const a = await fileOf(made[1]);
    const b = await fileOf(made[2]);
    const mask = await pixels(await strokeMask(ERASE_STROKES, a.width, a.height));
    let outside = 0;
    let inside = 0;
    for (let i = 0; i < a.width * a.height; i++) {
      const differs = [0, 1, 2, 3].some((c) => a.data[i * 4 + c] !== b.data[i * 4 + c]);
      if (differs && mask.data[i * 4 + 3] >= 128) outside++;
      if (differs && mask.data[i * 4 + 3] < 128) inside++;
    }
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(0);
  });

  it("an erase that comes back with nothing removed is tried once more, then refused plainly", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const before = (await designOf(A, itemA))!.pictures.post!.id;
    let calls = 0;
    // The model hands the picture back as it was.
    const spy = vi.spyOn(mockImageProvider, "edit").mockImplementation(async (req, model) => {
      calls++;
      return { bytes: req.source, mime: "image/png", model };
    });
    try {
      await expect(redrawArea(A, itemA, "post", { box: PIN_BOX, note: "", kind: "erase", strokes: ERASE_STROKES }))
        .rejects.toThrow("The erase came back with nothing removed, so it wasn't kept. Try brushing a little wider.");
      expect(calls).toBe(2);
      expect((await designOf(A, itemA))!.pictures.post!.id).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("a slice that fails part way carries on from where it stopped: done pins are never redone", { timeout: 90_000 }, async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    const real = visibleErase(mockImageProvider.edit.bind(mockImageProvider));
    let calls = 0;
    // The service is down for the second pin, then back. A paid picture call is not
    // tried again by the facade (PI-39), so that is one call; nothing came back for
    // the pin, so the queue's own retry applies (PI-30: no retry once a picture has).
    const spy = vi.spyOn(mockImageProvider, "edit").mockImplementation(async (req, model) => {
      calls++;
      if (calls === 2) throw new ProviderError("server", "The image service is down.", true);
      return real(req, model);
    });
    try {
      const { ids, jobId } = await send(A, v.id, threePins());
      for (let i = 0; i < 6; i++) {
        await drainJobs({ budgetMs: 20_000, onlyTenants: tenants });
        const j = await getJob(A, jobId);
        if (j && j.attempts >= 1) break;
      }
      const mid = await getJob(A, jobId);
      expect(mid?.status).toBe("queued"); // back in the queue, with backoff
      expect(mid?.attempts).toBe(1);
      expect(Object.keys((mid!.progress as { done: Record<string, string> }).done)).toEqual([ids[0]]);
      const first = (await getComment(A, ids[0]))!;
      expect(first.status).toBe("applied");
      expect((await getComment(A, ids[1]))!.status).toBe("working");

      // The backoff has passed: it carries on with pin 2, not pin 1 again.
      await admin("UPDATE jobs SET run_after = now() WHERE id=$1", [jobId]);
      const callsBefore = calls;
      expect((await settle(A, jobId))?.status).toBe("succeeded");
      expect(calls - callsBefore).toBe(2);
      const after = await Promise.all(ids.map((id) => getComment(A, id)));
      expect(after.map((p) => p!.status)).toEqual(["applied", "applied", "applied"]);
      expect(after[0]!.resultPictureId).toBe(first.resultPictureId);
      expect((await pictureRowOf(after[1]!.resultPictureId!)).parent_id).toBe(first.resultPictureId);
    } finally {
      spy.mockRestore();
    }
  });

  it("a pin that can't be done fails on its own and the rest go through; a job that stops for good fails every pin still waiting", { timeout: 90_000 }, async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    // A pin whose row is gone before it runs: its own failure, the other carries on.
    const own = await send(A, v.id, threePins().slice(0, 2));
    await admin("DELETE FROM visual_comments WHERE id=$1", [own.ids[0]]);
    const j1 = await settle(A, own.jobId);
    expect(j1?.status).toBe("succeeded");
    expect(j1!.result).toMatchObject({ changed: 1, failed: 1 });
    expect((await getComment(A, own.ids[1]))!.status).toBe("applied");

    // The service refuses the key on the second pin: no retry can fix that, so the job stops.
    const real = mockImageProvider.edit.bind(mockImageProvider);
    let calls = 0;
    const spy = vi.spyOn(mockImageProvider, "edit").mockImplementation(async (req, model) => {
      calls++;
      if (calls >= 2) throw new ProviderError("auth", "Bad key.");
      return real(req, model);
    });
    try {
      const { ids, jobId } = await send(A, v.id, threePins());
      expect((await settle(A, jobId))?.status).toBe("failed");
      const pins = await Promise.all(ids.map((id) => getComment(A, id)));
      expect(pins.map((p) => p!.status)).toEqual(["applied", "failed", "failed"]);
      // Worded as the picture service's refusal, not "Drafting" (PI-31).
      expect(pins[1]!.result).toMatch(/picture service refused the key/);
      expect(pins[2]!.result).toBe(pins[1]!.result);
      expect(pins[0]!.result).toBe("Redrew the marked area.");
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a Send with no pins, too many, a bad pin (keeping none of it), or from another workspace", async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    const count = async () => (await admin<{ n: number }>("SELECT count(*)::int AS n FROM visual_comments WHERE tenant_id=$1", [A.tenantId]))[0].n;
    const before = await count();
    await expect(addPictureComments(A, v.id, [])).rejects.toThrow(/at least one/);
    await expect(addPictureComments(A, v.id, Array.from({ length: 9 }, () => threePins()[0]))).rejects.toThrow(/more than 8/);
    await expect(addPictureComments(A, v.id, [threePins()[0], { kind: "markup", box: PIN_BOX, area: null, strokes: [], note: "x" }])).rejects.toThrow(/Draw on the picture/);
    await expect(addPictureComments(A, v.id, [{ kind: "erase", box: PIN_BOX, area: null, note: "" }])).rejects.toThrow(/Brush over/);
    await expect(addPictureComments(A, v.id, [{ kind: "comment", box: PIN_BOX, area: null, note: "  " }])).rejects.toThrow(/Say what/);
    await expect(addPictureComments(A, v.id, [{ kind: "paint", box: PIN_BOX, note: "x" }])).rejects.toThrow(/isn't a change/);
    await expect(addPictureComments({ ...B, projectId: A.projectId }, v.id, threePins())).rejects.toThrow(/isn't in this project/);
    await expect(addPictureComments(B, v.id, threePins())).rejects.toThrow(/isn't in this project/);
    // Marks and erasing are only for the picture.
    await expect(addComment(A, { visualId: v.id, target: "headline", box: PIN_BOX, note: "x", kind: "erase", strokes: ERASE_STROKES })).rejects.toThrow(/for the picture/);
    expect(await count()).toBe(before);
    // The database says the same, whatever the application does (migration 0025).
    await expect(admin(
      "INSERT INTO visual_comments (tenant_id, content_item_id, visual_id, target, box_x, box_y, box_w, box_h, note, kind) VALUES ($1,$2,$3,'headline',0.1,0.1,0.2,0.2,'x','erase')",
      [A.tenantId, itemA, v.id],
    )).rejects.toThrow(/visual_comments_kind_target_check/);
  });

  it("Try again redraws the area kept on the pin's row, not the pin's box on the visual", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    const area = { x: 0.05, y: 0.05, w: 0.2, h: 0.15 }; // on the picture
    const box = { x: 0.6, y: 0.6, w: 0.3, h: 0.3 }; // where the pin shows on the visual: elsewhere
    const c = await addComment(A, { visualId: v.id, target: "picture", box, area, note: "warmer here" });
    expect(c.area).toEqual({ x: expect.closeTo(0.05, 5), y: expect.closeTo(0.05, 5), w: expect.closeTo(0.2, 5), h: expect.closeTo(0.15, 5) });
    // It fails the first time (the cap), and the area is nowhere but on the row.
    await setImageCap(A, 0);
    const j1 = await enqueueJob(A, "picture_edit", { projectId: A.projectId, commentIds: [c.id] }, { label: "Changing the picture" });
    expect((await settle(A, j1))?.status).toBe("failed");
    expect((await getComment(A, c.id))?.status).toBe("failed");
    await setImageCap(A, null);

    // Try again queues the pin by its id only (retryCommentAction): the area comes from the row.
    const again = await failedComment(A, c.id);
    const before = (await designOf(A, itemA))!.pictures.post!.id;
    const j2 = await enqueueJob(A, "picture_edit", { projectId: A.projectId, commentIds: [again.id], commentId: again.id }, { label: "Changing the picture" });
    expect((await settle(A, j2))?.status).toBe("succeeded");
    const was = await fileOf(before);
    const now = await fileOf((await getComment(A, c.id))!.resultPictureId!);
    const changed = (b: typeof box) => {
      let n = 0;
      for (let y = Math.floor(b.y * was.height); y < (b.y + b.h) * was.height; y += 4) {
        for (let x = Math.floor(b.x * was.width); x < (b.x + b.w) * was.width; x += 4) {
          const i = (y * was.width + x) * 4;
          if (was.data[i] !== now.data[i] || was.data[i + 1] !== now.data[i + 1] || was.data[i + 2] !== now.data[i + 2]) n++;
        }
      }
      return n;
    };
    expect(changed(area)).toBeGreaterThan(0);
    expect(changed(box)).toBe(0);
  });
});

describe("picture tools: Resize", () => {
  it("a covered frame is a crop: no model call, no generation log, the new shape, a version marked resized", async () => {
    if (!dbReachable) return;
    const start = (await designOf(A, itemA))!.pictures.post!.id; // 1024 x 1536 from the stand-in
    const square = { ratio: 1, place: { x: 0, y: -0.25, w: 1, h: 1.5 } };
    expect(await resizeKind(A, itemA, "post", square)).toBe("crop");
    const logs = await imageLogs(A);
    const id = await resizePicture(A, itemA, "post", square);
    expect(await imageLogs(A)).toBe(logs);
    const row = await pictureRowOf(id);
    expect([row.width, row.height, row.parent_id, row.params.op, row.params.shape]).toEqual([1024, 1024, start, "resize", "square"]);
    // The middle of the picture, exactly.
    const was = await fileOf(start);
    const now = await fileOf(id);
    const at = (p: typeof was, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3)];
    expect(at(now, 500, 0)).toEqual(at(was, 500, 256));
    expect(at(now, 1023, 1023)).toEqual(at(was, 1023, 1279));
    expect(await previousPicture(A, itemA, "post")).toBe(true);
  });

  it("a bigger frame is drawn by the model and logged once; the original comes back pixel for pixel in its place", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const start = (await designOf(A, itemA))!.pictures.post!.id;
    const wide = { ratio: 1, place: { x: (1 - 1024 / 1536) / 2, y: 0, w: 1024 / 1536, h: 1 } };
    expect(await resizeKind(A, itemA, "post", wide)).toBe("extend");
    const logs = await imageLogs(A);
    const id = await resizePicture(A, itemA, "post", wide);
    expect(await imageLogs(A)).toBe(logs + 1);
    const row = await pictureRowOf(id);
    expect([row.width % 16, row.height % 16, row.width]).toEqual([0, 0, row.height]);
    expect([row.parent_id, row.params.op, row.params.shape]).toEqual([start, "resize", "square"]);
    const now = await fileOf(id);
    // No matte green left anywhere.
    let green = 0;
    for (let i = 0; i < now.data.length; i += 16) if (now.data[i + 1] > 215 && now.data[i] < 70 && now.data[i + 2] < 70) green++;
    expect(green).toBe(0);
    // Inside its place (past the soft edge), the original at that size, exactly.
    const left = Math.round(wide.place.x * row.width);
    const placedW = Math.round(wide.place.w * row.width);
    const src = (await storage().get((await pictureRowOf(start)).storage_key))!.data;
    const ref = await pixels(new Uint8Array(await sharp(Buffer.from(src)).removeAlpha().resize(placedW, row.height, { fit: "fill" }).png().toBuffer()));
    let moved = 0;
    for (let y = 0; y < row.height; y += 9) {
      for (let x = 20; x < placedW - 20; x += 9) {
        const a = (y * now.width + left + x) * 4;
        const b = (y * ref.width + x) * 4;
        if (now.data[a] !== ref.data[b] || now.data[a + 1] !== ref.data[b + 1] || now.data[a + 2] !== ref.data[b + 2]) moved++;
      }
    }
    expect(moved).toBe(0);
    expect(await previousPicture(A, itemA, "post")).toBe(true);
  });

  it("an answer that moved the picture is tried three times in all, then refused plainly", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const before = (await designOf(A, itemA))!.pictures.post!.id;
    let calls = 0;
    // The service hands back a scene slid sideways: the original's place no longer holds the original.
    const spy = vi.spyOn(mockImageProvider, "edit").mockImplementation(async (req, model) => {
      calls++;
      const { width, height } = await sharp(Buffer.from(req.source)).metadata();
      const slid = await sharp(Buffer.from(req.source)).extend({ left: Math.round(width! / 4), background: "#7f7f7f" }).extract({ left: 0, top: 0, width: width!, height: height! }).png().toBuffer();
      return { bytes: new Uint8Array(slid), mime: "image/png", model, width, height };
    });
    try {
      const wide = { ratio: 1, place: { x: (1 - 1024 / 1536) / 2, y: 0, w: 1024 / 1536, h: 1 } };
      await expect(resizePicture(A, itemA, "post", wide)).rejects.toThrow("The picture came back shifted, so it was not kept. Try again.");
      expect(EXTEND_TRIES).toBe(3);
      expect(calls).toBe(EXTEND_TRIES);
      expect((await designOf(A, itemA))!.pictures.post!.id).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("two shifted answers and a good third one: the third is kept", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const before = (await designOf(A, itemA))!.pictures.post!.id;
    const real = mockImageProvider.edit.bind(mockImageProvider);
    let calls = 0;
    const spy = vi.spyOn(mockImageProvider, "edit").mockImplementation(async (req, model) => {
      calls++;
      if (calls === 3) return real(req, model);
      const { width, height } = await sharp(Buffer.from(req.source)).metadata();
      const slid = await sharp(Buffer.from(req.source)).extend({ left: Math.round(width! / 4), background: "#7f7f7f" }).extract({ left: 0, top: 0, width: width!, height: height! }).png().toBuffer();
      return { bytes: new Uint8Array(slid), mime: "image/png", model, width, height };
    });
    try {
      const wide = { ratio: 1, place: { x: (1 - 1024 / 1536) / 2, y: 0, w: 1024 / 1536, h: 1 } };
      const id = await resizePicture(A, itemA, "post", wide);
      expect(calls).toBe(3);
      expect(id).not.toBe(before);
      expect((await designOf(A, itemA))!.pictures.post!.id).toBe(id);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a picture with its heading drawn in, and a shape that leaves too little of the picture", async () => {
    if (!dbReachable) return;
    await expect(resizeKind(A, itemA, "quote", { ratio: 1.5, place: { x: 0, y: 0, w: 1, h: 1 } })).rejects.toThrow(/heading drawn in/);
    await expect(resizeKind(A, itemA, "post", { ratio: 2.5, place: { x: 0.4, y: 0, w: 0.27, h: 1 } })).rejects.toThrow("Draw a new picture in this shape instead.");
    await expect(resizeKind({ ...B, projectId: A.projectId }, itemA, "post", { ratio: 1, place: { x: 0, y: -0.25, w: 1, h: 1 } })).rejects.toThrow();
  });
});

describe("picture tools: Remove background", () => {
  it("cuts the subject out as a new version with alpha, logged as no picture, and the visual knows it is a cut-out", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const planted = await plant(A, itemA, "post", await subjectPng());
    expect(await cutOutRefusal(A, itemA, "post")).toBeNull();
    const jobId = await enqueueJob(A, "picture_cutout", { projectId: A.projectId, contentItemId: itemA, artboard: "post" }, { label: "Removing the background" });
    const job = await settle(A, jobId);
    expect(job?.status).toBe("succeeded");
    const id = (job!.result as { pictureId: string }).pictureId;
    const row = await pictureRowOf(id);
    expect([row.parent_id, row.params.op, row.params.cutout]).toEqual([planted, "cutout", true]);
    const bytes = (await storage().get(row.storage_key))!.data;
    const meta = await sharp(Buffer.from(bytes)).metadata();
    // Kept to its subject (trimToSubject): smaller than the 400 x 500 picture, solid in the middle.
    expect([meta.format, meta.hasAlpha]).toEqual(["png", true]);
    expect(meta.width! < 400 && meta.height! < 500).toBe(true);
    const px = await pixels(bytes);
    const mid = (Math.floor(meta.height! / 2) * meta.width! + Math.floor(meta.width! / 2)) * 4 + 3;
    expect(px.data[mid]).toBe(255);
    expect((await designOf(A, itemA))!.pictures.post).toEqual({ id, mode: "live_text", cutout: true });
    const [log] = await admin<{ model: string; image_count: number; status: string }>(
      "SELECT model, image_count, status FROM generation_logs WHERE tenant_id=$1 AND kind='image' ORDER BY created_at DESC LIMIT 1", [A.tenantId],
    );
    expect(log).toEqual({ model: "cutout:mock", image_count: 0, status: "ok" });
    expect((await pictureVersions(A)).find((x) => x.id === id)).toMatchObject({ op: "cutout", cutout: true });
  });

  it("a cut-out takes no further changes until the version before is put back", async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    expect(await cutOutRefusal(A, itemA, "post")).toBe("This picture already has its background removed.");
    await expect(redrawArea(A, itemA, "post", { box: PIN_BOX, note: "x" })).rejects.toThrow(CUTOUT_LOCKED);
    await expect(redrawArea(A, itemA, "post", PIN_BOX, "x")).rejects.toThrow(CUTOUT_LOCKED);
    await expect(redrawArea(A, itemA, "post", { box: PIN_BOX, note: "", kind: "erase", strokes: ERASE_STROKES })).rejects.toThrow(CUTOUT_LOCKED);
    await expect(resizePicture(A, itemA, "post", { ratio: 1, place: { x: 0, y: -0.125, w: 1, h: 1 } })).rejects.toThrow(CUTOUT_LOCKED);
    await expect(addPictureComments(A, v.id, threePins())).rejects.toThrow(CUTOUT_LOCKED);
    await expect(addComment(A, { visualId: v.id, target: "picture", box: PIN_BOX, note: "x" })).rejects.toThrow(CUTOUT_LOCKED);
    // Undo goes back to the picture it was cut from, which is not a cut-out.
    expect(await previousPicture(A, itemA, "post")).toBe(true);
    expect((await designOf(A, itemA))!.pictures.post!.cutout).toBeUndefined();
    expect(await cutOutRefusal(A, itemA, "post")).toBeNull();
  });

  it("refuses a picture with its heading drawn in, and one with no clear subject (nothing is kept)", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    expect(await cutOutRefusal(A, itemA, "quote")).toMatch(/heading drawn in/);
    await expect(cutOutPicture(A, itemA, "quote")).rejects.toThrow(/heading drawn in/);
    const flat = await plant(A, itemA, "post", new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#b0c4de" } }).png().toBuffer()));
    await expect(cutOutPicture(A, itemA, "post")).rejects.toThrow("There's no clear subject to cut out in this picture.");
    expect((await designOf(A, itemA))!.pictures.post!.id).toBe(flat);
    await expect(cutOutPicture({ ...B, projectId: A.projectId }, itemA, "post")).rejects.toThrow();
  });
});

describe("picture tools: the image cap stops each tool", () => {
  it("at a cap of 0 a Send, an extension and a cut-out all stop with the plain reason; a crop is free and still works", { timeout: 90_000 }, async () => {
    if (!dbReachable) return;
    const v = await visual(A);
    await plant(A, itemA, "post", await subjectPng());
    await setImageCap(A, 0);
    try {
      const { ids, jobId } = await send(A, v.id, threePins());
      expect((await settle(A, jobId))?.status).toBe("failed");
      for (const id of ids) {
        const pin = await getComment(A, id);
        expect(pin?.status).toBe("failed");
        expect(pin?.result).toMatch(/switched off/);
      }
      await expect(resizePicture(A, itemA, "post", { ratio: 1.6, place: { x: 0.25, y: 0, w: 0.5, h: 1 } })).rejects.toMatchObject({ name: "UsageCapError" });
      await expect(cutOutPicture(A, itemA, "post")).rejects.toMatchObject({ name: "UsageCapError" });
      const crop = await resizePicture(A, itemA, "post", { ratio: 1, place: { x: 0, y: -0.125, w: 1, h: 1 } });
      expect((await pictureRowOf(crop)).params.op).toBe("resize");
    } finally {
      await setImageCap(A, null);
    }
  });
});
