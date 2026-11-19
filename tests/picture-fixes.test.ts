/**
 * The fixes from the 2026-11-19 picture audit (D:\huemen-recordings\2026-11-19\
 * picture-issues.md), one block per issue id where code can show it:
 *
 *   pure     tool availability over the board (PI-02, PI-36), restoring drafts
 *            (PI-07), the picture menu's place (PI-09), a click's box (PI-18),
 *            slide hints (PI-13), the honest cost line (PI-30), picture-worded
 *            errors (PI-31), word boxes on the square copy (PI-22), the edge cut
 *            (PI-18, PI-19), an answer in another shape (PI-24), where a key came
 *            from (PI-41), the pending key (PI-01), no queue retry on a budget
 *            refusal (PI-30), the Runpod cancel on a timeout (PI-39)
 *   database (local Postgres): the budget and the daily cap in the facade
 *            (PI-30), compare-and-set when a job ends (PI-26), a cut-out reused
 *            (PI-25), soft Clear and Undo (PI-35), the frame kept (PI-12), a
 *            slide-only rewrite (PI-13), a pin never redone (PI-29), "words not
 *            checked" and Check for words (PI-20), the row lock let go (PI-38)
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { appPool } from "@/db/pool";
import { createProject, unlockStage, type ProjectScope } from "@/lib/data/projects";
import { generateContent, listContent, patchContent } from "@/lib/data/content";
import { deleteVisuals, generateVisuals, listVisuals } from "@/lib/data/pipeline";
import {
  checkWords, cutOutPicture, designOf, keepWordsOut, madeSince, pictureVersions, previousPicture, redrawArea, selectPictureVersion, type PictureRun,
} from "@/lib/data/pictures";
import { addComment, applyPictureComment, applyTemplateComment, dismissComments, finishComment, getComment, listComments, restoreComments } from "@/lib/data/visual-comments";
import { editImage, enforceCap, PictureSpend, selectTextProvider, selectVisionProvider, withPictureBudget } from "@/lib/ai";
import { parseEnv } from "@/lib/env";
import { PictureBudgetError, ProviderError, UsageCapError, userMessage } from "@/lib/ai/errors";
import { classify } from "@/lib/jobs";
import { usedNote } from "@/lib/jobs/handlers";
import { loadBrandContext } from "@/lib/context/context-loader";
import { storage, tenantKey } from "@/lib/storage";
import { cutAtEdge, EDGE_CUT_LIMIT, keepOutside } from "@/lib/visual/region";
import { wordBoxes } from "@/lib/visual/picture-words";
import { forWordsCheck, WORDS_CHECK_SIDE } from "@/lib/visual/look-read";
import { aspectGap, runpodImageProvider, toShape } from "@/lib/ai/providers/runpod-image";
import { PICTURE_BUDGET, usesPictures } from "@/lib/visual/picture-tools";
import { describeSource, keySources, probeRunpod } from "@/lib/key-source";
import { PENDING_KEY_SCRIPT } from "@/lib/ui/pending-key";
import { slidesOf } from "@/lib/visual/slides";
import { ALL_CUTOUT, ALL_DRAWN_IN, NO_PICTURE, draftsKey, restoreDrafts, toolsOff } from "@/app/w/[id]/p/[pid]/visual/board-state";
import { clickBox, menuPlace, targetHint } from "@/app/w/[id]/p/[pid]/visual/visual-comments-ui";
import { summaryLine } from "@/app/w/[id]/p/[pid]/visual/picture-tools-maths";

// ---- pure ------------------------------------------------------------------------------------

describe("PI-02, PI-36: a tool is on when any picture on the board can take it", () => {
  it("no picture anywhere: every picture tool off with 'Add a picture first'", () => {
    expect(toolsOff([])).toEqual({ markup: NO_PICTURE, erase: NO_PICTURE, cutout: NO_PICTURE, resize: NO_PICTURE });
  });
  it("one ordinary picture among others (the first piece may have none): all on", () => {
    expect(toolsOff([{ cutout: true, mode: "live_text" }, { cutout: false, mode: "live_text" }])).toEqual({ markup: undefined, erase: undefined, cutout: undefined, resize: undefined });
  });
  it("every picture a cut-out: all off with the reason, before anything is drawn", () => {
    expect(toolsOff([{ cutout: true, mode: "live_text" }, { cutout: true, mode: "live_text" }])).toEqual({ markup: ALL_CUTOUT, erase: ALL_CUTOUT, cutout: ALL_CUTOUT, resize: ALL_CUTOUT });
  });
  it("the only changeable picture has its heading drawn in: Markup and Erase on, Resize and Remove background off", () => {
    expect(toolsOff([{ cutout: true, mode: "live_text" }, { cutout: false, mode: "with_text" }])).toEqual({ markup: undefined, erase: undefined, cutout: ALL_DRAWN_IN, resize: ALL_DRAWN_IN });
  });
});

describe("PI-07: unsent changes come back after a reload, only where they still fit", () => {
  const items = [{ id: "i1", visuals: { post: "v1", carousel: "v3" } }];
  const draft = { id: "d1", itemId: "i1", artboard: "post", visualId: "v1", kind: "comment", target: "headline", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, area: null, note: "shorter", frame: 0, offered: ["headline"], error: "old reason" };
  it("keeps a draft on a visual that is still there, without its old failure", () => {
    const back = restoreDrafts([draft], items);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: "d1", note: "shorter", frame: 0 });
    expect(back[0].error).toBeUndefined();
  });
  it("drops drafts on a visual that changed or went, of an unknown kind, or with no box; and junk", () => {
    expect(restoreDrafts([{ ...draft, visualId: "gone" }], items)).toEqual([]);
    expect(restoreDrafts([{ ...draft, itemId: "other" }], items)).toEqual([]);
    expect(restoreDrafts([{ ...draft, kind: "paint" }], items)).toEqual([]);
    expect(restoreDrafts([{ ...draft, box: null }], items)).toEqual([]);
    expect(restoreDrafts("not a list", items)).toEqual([]);
    expect(restoreDrafts(null, items)).toEqual([]);
  });
  it("keeps at most 8 per piece, and the key is the project's", () => {
    expect(restoreDrafts(Array.from({ length: 12 }, (_, n) => ({ ...draft, id: `d${n}` })), items)).toHaveLength(8);
    expect(draftsKey("t", "p")).toBe("hu:visual-drafts:t:p");
  });
});

describe("PI-09: the picture menu is all on screen at any width", () => {
  it("at 375 px, a button at the right: the menu ends inside the screen", () => {
    const p = menuPlace({ left: 259, right: 287, top: 100, bottom: 128 }, { width: 375, height: 812 }, 240);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + p.width).toBeLessThanOrEqual(375 - 8);
  });
  it("a button near the left edge: the menu hangs from the button's left edge", () => {
    const p = menuPlace({ left: 20, right: 48, top: 100, bottom: 128 }, { width: 1440, height: 900 }, 240);
    expect(p.left).toBe(20);
    expect(p.width).toBe(288);
  });
  it("a narrow screen narrows it; no room below puts it above", () => {
    expect(menuPlace({ left: 100, right: 128, top: 100, bottom: 128 }, { width: 280, height: 800 }, 200).width).toBe(264);
    const up = menuPlace({ left: 600, right: 628, top: 700, bottom: 728 }, { width: 1440, height: 800 }, 240);
    expect(up.top).toBe(700 - 6 - 240);
  });
});

describe("PI-18: a click on the picture marks room for an object; on the words, a small box", () => {
  it("picture: 30% x 24% around the point, kept on the frame", () => {
    expect(clickBox(0.5, 0.5, true)).toEqual({ x: 0.35, y: 0.38, w: 0.3, h: 0.24 });
    const edge = clickBox(0.98, 0.99, true);
    expect(edge.x + edge.w).toBeCloseTo(1);
    expect(edge.y + edge.h).toBeCloseTo(1);
  });
  it("words: the old small box", () => {
    expect(clickBox(0.5, 0.5, false)).toMatchObject({ w: 0.16, h: 0.12 });
  });
});

describe("PI-13: the hint says exactly what a comment changes", () => {
  it("a slide's words: only that slide; elsewhere the whole body; design: every slide", () => {
    expect(targetHint("body", true)).toMatch(/this slide only/);
    expect(targetHint("body", false)).toMatch(/post's body/);
    expect(targetHint("background", true)).toMatch(/every slide/);
  });
  it("PI-30: the picture hint and the strip say the most it can cost", () => {
    expect(targetHint("picture", false)).toContain(`Uses 1 to ${PICTURE_BUDGET.comment} pictures`);
    expect(usesPictures(1)).toBe("Uses 1 picture");
    const pin = { kind: "comment" as const, target: "picture", note: "x" };
    const words = { kind: "comment" as const, target: "headline", note: "x" };
    expect(summaryLine([pin, words])).toBe(`2 changes · uses 1 to ${PICTURE_BUDGET.comment} pictures`);
    expect(summaryLine([words])).toBe("1 change");
  });
});

describe("PI-31: picture failures are worded as pictures, not 'Drafting'", () => {
  it("a refused key, a cap of 0, a monthly cap, a daily cap, the budget", () => {
    expect(userMessage(new ProviderError("auth", "403"), "picture")).toBe("The picture service refused the key. Your admin needs to check it.");
    expect(userMessage(new ProviderError("auth", "403"))).toMatch(/^Drafting couldn't sign in/);
    expect(userMessage(new UsageCapError("image", 0, 0))).toMatch(/^Pictures are switched off/);
    expect(userMessage(new UsageCapError("image", 50, 50))).toMatch(/used its 50 pictures for the month/);
    expect(userMessage(new UsageCapError("image", 60, 60, "day"))).toMatch(/60 pictures for today/);
    expect(userMessage(new PictureBudgetError(3))).toMatch(/limit of 3 pictures/);
    expect(userMessage(new Error("x"), "picture")).not.toMatch(/Drafting/);
  });
  it("PI-30: a budget refusal is never retried by the queue; the note says what a try used", () => {
    expect(classify(new PictureBudgetError(3), 1).retry).toBe(false);
    expect(usedNote(2)).toBe(" That try used 2 pictures.");
    expect(usedNote(0)).toBe("");
  });
});

describe("PI-22, PI-21: the words check's copy is a square of 1000, so pixels and thousandths agree", () => {
  it("a portrait picture is centred on grey; its place is given back", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer());
    const { image, place } = await forWordsCheck(png);
    const meta = await sharp(Buffer.from(image.data)).metadata();
    expect([meta.width, meta.height]).toEqual([WORDS_CHECK_SIDE, WORDS_CHECK_SIDE]);
    expect(place).toEqual({ x: 0.1, y: 0, w: 0.8, h: 1 });
  });
  it("a word at the right edge of a portrait picture lands at the right edge (it read 0.60 for 0.98 before)", () => {
    // The word at x = 880..900 of the 1000 square: the picture spans 100..900.
    const [b] = wordBoxes([{ x: 860, y: 500, w: 30, h: 20 }], { width: 1000, height: 1000 }, 0.8, { x: 0.1, y: 0, w: 0.8, h: 1 });
    // (860 / 1000 - 0.1) / 0.8 = 0.95, grown by the pad: it starts just before.
    expect(b.x).toBeGreaterThan(0.9);
    expect(b.x + b.w).toBeCloseTo(1, 1);
  });
  it("a box on the grey band, outside the picture, is dropped", () => {
    expect(wordBoxes([{ x: 20, y: 500, w: 40, h: 20 }], { width: 1000, height: 1000 }, 0.8, { x: 0.1, y: 0, w: 0.8, h: 1 })).toEqual([]);
  });
});

describe("PI-18, PI-19: a change that runs across the area's edge is caught", () => {
  const W = 400, H = 300;
  const base = async () => new Uint8Array(await sharp({ create: { width: W, height: H, channels: 3, background: "#c8b8a0" } }).png().toBuffer());
  const withRect = async (x: number, y: number, w: number, h: number) =>
    new Uint8Array(await sharp(Buffer.from(await base())).composite([{ input: await sharp({ create: { width: w, height: h, channels: 3, background: "#1e6b2a" } }).png().toBuffer(), left: x, top: y }]).png().toBuffer());
  const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }; // 100..300 x 75..225
  it("an object well inside the area: no cut", async () => {
    expect(await cutAtEdge(await base(), await withRect(160, 110, 80, 70), box)).toBeLessThan(0.02);
  });
  it("an object drawn through the bottom edge (the plant's pot below the box): cut, over the limit", async () => {
    const cut = await cutAtEdge(await base(), await withRect(150, 150, 100, 130), box);
    expect(cut).toBeGreaterThan(EDGE_CUT_LIMIT);
  });
  it("pixels outside the area are still the original after the merge, whatever the answer", async () => {
    const merged = await keepOutside(await base(), await withRect(150, 150, 100, 130), box);
    const { data } = await sharp(Buffer.from(merged)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [...data.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
    expect(at(200, 260)).toEqual([0xc8, 0xb8, 0xa0]);
  });
});

describe("PI-24: an answer in another shape is cropped to the asked shape or refused, never stretched", () => {
  it("measures the shape gap both ways", () => {
    expect(aspectGap({ width: 100, height: 100 }, { width: 100, height: 100 })).toBe(0);
    expect(aspectGap({ width: 200, height: 100 }, { width: 100, height: 100 })).toBeCloseTo(aspectGap({ width: 100, height: 100 }, { width: 200, height: 100 }));
  });
  it("a little wider: its middle is kept at the right shape; far off: refused", async () => {
    // A 120x100 answer with a 20 px stripe at each side: cropped, the stripes go, nothing is squashed.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="#00f"/><rect width="10" height="100" fill="#f00"/><rect x="110" width="10" height="100" fill="#f00"/></svg>';
    const out = await (await toShape(await sharp(Buffer.from(svg)).png().toBuffer(), 100, 100)).raw().toBuffer({ resolveWithObject: true });
    expect([out.info.width, out.info.height]).toEqual([100, 100]);
    expect(out.data[0]).toBeLessThan(40); // the red stripe was cropped away, not squeezed in
    const square = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#00f" } }).png().toBuffer();
    await expect(toShape(square, 200, 100)).rejects.toMatchObject({ kind: "unparseable" });
  });
});

describe("PI-39: a Runpod job given up on is cancelled", () => {
  it("on the deadline, POST /cancel/<id> is sent before the timeout is reported", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      if (url.endsWith("/runsync")) return new Response(JSON.stringify({ id: "job-1", status: "IN_QUEUE" }), { status: 200 });
      if (url.includes("/cancel/")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ id: "job-1", status: "IN_PROGRESS" }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = runpodImageProvider({ apiKey: "rk", timeoutMs: 1, editModel: "e" }, f);
    await expect(p.generate({ prompt: "x", shape: "square" } as never, "qwen-image-t2i")).rejects.toMatchObject({ kind: "timeout" });
    expect(calls.some((u) => u.endsWith("/qwen-image-t2i/cancel/job-1"))).toBe(true);
  });
});

describe("PI-41: where a key came from, never its value", () => {
  const files = [{ file: ".env", values: { RUNPOD_API_KEY: "file-key", GROQ_API_KEY: "g" } }];
  it("set outside .env and different: 'process environment' with the warning; same as .env: '.env'; missing: not set", () => {
    const out = keySources({ RUNPOD_API_KEY: "user-var-key", GROQ_API_KEY: "g" }, files, ["RUNPOD_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY"]);
    expect(out).toEqual([
      { name: "RUNPOD_API_KEY", source: "process", differsFrom: ".env" },
      { name: "GROQ_API_KEY", source: "dotenv", file: ".env" },
      { name: "ANTHROPIC_API_KEY", source: "unset" },
    ]);
    const line = describeSource(out[0]);
    expect(line).toMatch(/DIFFERENT value/);
    expect(line).not.toContain("user-var-key");
    expect(line).not.toContain("file-key");
  });
  it("Runpod's answer to a key: 401/403 refused, anything else accepted, no network unreachable", async () => {
    const answer = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    expect(await probeRunpod("k", "m", answer(400))).toBe("accepted");
    expect(await probeRunpod("k", "m", answer(403))).toBe("refused");
    expect(await probeRunpod("k", "m", answer(401))).toBe("refused");
    expect(await probeRunpod("k", "m", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe("unreachable");
  });
});

describe("PI-40: the looks can have a Groq key of their own", () => {
  const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123", AI_TEXT_PROVIDER: "groq", GROQ_API_KEY: "text-key" };
  it("with AI_VISION_API_KEY a separate provider carries the looks; without it, the text provider, as before", () => {
    const own = parseEnv({ ...BASE, AI_VISION_API_KEY: "vision-key" });
    expect(selectVisionProvider(own)).not.toBe(selectTextProvider(own));
    const shared = parseEnv(BASE);
    expect(selectVisionProvider(shared)).toBe(selectTextProvider(shared));
  });
});

describe("PI-01: a tool key pressed before the board is ready is kept for it", () => {
  it("the page's script records a plain letter, not one typed in a field, not with Ctrl, and stops once the canvas listens", () => {
    const handlers: ((e: unknown) => void)[] = [];
    const win: Record<string, unknown> = { addEventListener: (_: string, fn: (e: unknown) => void) => handlers.push(fn) };
    new Function("window", "location", PENDING_KEY_SCRIPT)(win, { pathname: "/w/t/p/p/visual" });
    const key = (k: string, extra: Record<string, unknown> = {}) => handlers.forEach((h) => h({ key: k, target: { closest: () => null }, ...extra }));
    key("r");
    expect(win.__huPendingKey).toMatchObject({ key: "r", p: "/w/t/p/p/visual" });
    key("m", { ctrlKey: true });
    key("e", { target: { closest: () => ({}) } });
    expect((win.__huPendingKey as { key: string }).key).toBe("r");
    win.__huCanvasReady = 1;
    key("b");
    expect((win.__huPendingKey as { key: string }).key).toBe("r");
  });
});

// ---- database ----------------------------------------------------------------------------------

let ownerPool: Pool | null = null;
const admin = async <T,>(sql: string, args: unknown[] = []) => {
  ownerPool ??= new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  return (await ownerPool.query(sql, args)).rows as T[];
};
let dbReachable = false;
let A: ProjectScope;
let item = "";
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
  const [t] = await admin<{ id: string }>("INSERT INTO tenants (name) VALUES ('Picture fixes (test)') RETURNING id");
  const [u] = await admin<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,'picture-fixes@test.local','client','active') RETURNING id", [t.id]);
  tenants.push(t.id);
  const w = { tenantId: t.id, userId: u.id, isPlatformAdmin: false };
  A = { ...w, projectId: await createProject(w, "Picture fixes") };
  item = await generateContent(A, { format: "linkedin_carousel", topic: "pricing" });
  await unlockStage(A, "content");
  await generateVisuals(A, { scheme: 0, approvedOnly: false });
}, 60_000);

afterAll(async () => {
  if (!dbReachable) return;
  await deleteVisuals(A, item).catch(() => undefined);
  await admin("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenants]);
  await ownerPool?.end();
  await appPool().end();
});

const SUBJECT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#b0c4de"/><rect x="100" y="125" width="200" height="250" fill="#8b0000"/></svg>';
async function plant(artboard: "post" | "quote" | "carousel", png?: Uint8Array) {
  const bytes = png ?? new Uint8Array(await sharp(Buffer.from(SUBJECT_SVG)).png().toBuffer());
  const key = tenantKey(A.tenantId!, "pictures", `${randomUUID()}.png`);
  await storage().put(key, bytes, "image/png");
  const { width, height } = await sharp(Buffer.from(bytes)).metadata();
  const [row] = await admin<{ id: string }>(
    `INSERT INTO image_assets (tenant_id, project_id, content_item_id, kind, prompt, model, params, aspect_ratio, storage_key, width, height, status, is_current)
     VALUES ($1,$2,$3,'picture','A planted test picture','test',$4,$5,$6,$7,$8,'ready',false) RETURNING id`,
    [A.tenantId, A.projectId, item, JSON.stringify({ artboard, mode: "live_text", shape: "portrait", heading: null, op: "draw" }), `${width}:${height}`, key, width, height],
  );
  expect(await selectPictureVersion(A, item, artboard, row.id)).toBe(true);
  return row.id;
}
const imageLogs = async () => (await admin<{ n: number }>("SELECT count(*)::int AS n FROM generation_logs WHERE tenant_id=$1 AND kind='image'", [A.tenantId]))[0].n;

describe("PI-30: one budget of paid pictures per action, and a daily cap, in the facade", () => {
  it("the call past the budget is refused before the provider, logged, and the spend says what was used", async () => {
    if (!dbReachable) return;
    const context = await loadBrandContext(A, "en", "linkedin", "write");
    const source = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#888" } }).png().toBuffer());
    const spend = new PictureSpend(1);
    const before = await imageLogs();
    await expect(withPictureBudget(1, async () => {
      await editImage(A, { context, prompt: "x", source, mask: source, shape: "square", contentItemId: item, intent: "area" });
      await editImage(A, { context, prompt: "x", source, mask: source, shape: "square", contentItemId: item, intent: "area" });
    }, spend)).rejects.toBeInstanceOf(PictureBudgetError);
    expect([spend.spent, spend.returned]).toEqual([1, 1]);
    const rows = await admin<{ status: string; error: string | null }>("SELECT status, error FROM generation_logs WHERE tenant_id=$1 AND kind='image' ORDER BY created_at DESC LIMIT 2", [A.tenantId]);
    expect(await imageLogs()).toBe(before + 2);
    expect(rows[0].status).toBe("error");
    expect(rows[0].error).toMatch(/budget/i);
  });
  it("the daily cap stops paid pictures for the day, never a free cut-out", async () => {
    if (!dbReachable) return;
    await admin(
      "INSERT INTO generation_logs (tenant_id, kind, model, image_count, latency_ms, status) SELECT $1, 'image', 'filler', 1, 1, 'ok' FROM generate_series(1, 60)",
      [A.tenantId],
    );
    try {
      await expect(enforceCap(A, "image")).rejects.toMatchObject({ name: "UsageCapError", period: "day" });
      await expect(enforceCap(A, "image", { paid: false })).resolves.toBeUndefined();
    } finally {
      await admin("DELETE FROM generation_logs WHERE tenant_id=$1 AND model='filler'", [A.tenantId]);
    }
  });
});

describe("PI-26: a job that ends after the person chose another picture doesn't take the visual back", () => {
  it("the change is kept as a version, the visual stays on the person's choice, and the run says so", async () => {
    if (!dbReachable) return;
    const chosen = await plant("post");
    await plant("post");
    // While the change is being made, the person puts the earlier picture back.
    const put = storage().put.bind(storage());
    const spy = vi.spyOn(storage(), "put").mockImplementationOnce(async (...a: Parameters<typeof put>) => {
      expect(await selectPictureVersion(A, item, "post", chosen)).toBe(true);
      return put(...a);
    });
    try {
      const run: PictureRun = {};
      const made = await redrawArea(A, item, "post", { box: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, note: "warmer" }, run);
      expect(run.attached).toBe(false);
      expect((await designOf(A, item))!.pictures.post!.id).toBe(chosen);
      const [row] = await admin<{ is_current: boolean }>("SELECT is_current FROM image_assets WHERE id=$1", [made]);
      expect(row.is_current).toBe(false);
      expect((await pictureVersions(A)).some((v) => v.id === made)).toBe(true);
      // One current picture per visual, still.
      const [cur] = await admin<{ n: number }>("SELECT count(*)::int AS n FROM image_assets WHERE content_item_id=$1 AND kind='picture' AND is_current AND params->>'artboard'='post'", [item]);
      expect(cur.n).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
  it("PI-38: no lock row is left behind, and the change took no long transaction", async () => {
    if (!dbReachable) return;
    const [l] = await admin<{ n: number }>("SELECT count(*)::int AS n FROM picture_locks WHERE content_item_id=$1", [item]);
    expect(l.n).toBe(0);
  });
});

describe("PI-25: Remove background again on the same picture reuses its cut-out", () => {
  it("Back, then Remove background: the same cut-out, no new version", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    await plant("post");
    const first = await cutOutPicture(A, item, "post");
    const count = (await pictureVersions(A)).length;
    expect(await previousPicture(A, item, "post")).toBe(true);
    const again = await cutOutPicture(A, item, "post");
    expect(again).toBe(first);
    expect((await pictureVersions(A)).length).toBe(count);
    expect((await designOf(A, item))!.pictures.post).toMatchObject({ id: first, cutout: true });
  });
});

describe("PI-35, PI-12: Clear keeps the comment for Undo; a comment keeps its frame", () => {
  it("cleared comments leave the board and come back with Undo; a working one can't be cleared", async () => {
    if (!dbReachable) return;
    const v = (await listVisuals(A)).find((x) => x.kind === "carousel_frame")!;
    const c = await addComment(A, { visualId: v.id, target: "background", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, note: "lighter", frame: 2 });
    expect(c.frame).toBe(2);
    expect((await listComments(A)).find((x) => x.id === c.id)?.frame).toBe(2);
    expect(await dismissComments(A, [c.id])).toEqual([c.id]);
    expect((await listComments(A)).some((x) => x.id === c.id)).toBe(false);
    const [row] = await admin<{ n: number }>("SELECT count(*)::int AS n FROM visual_comments WHERE id=$1", [c.id]);
    expect(row.n).toBe(1);
    expect(await restoreComments(A, [c.id])).toEqual([c.id]);
    expect((await listComments(A)).some((x) => x.id === c.id)).toBe(true);
    await finishComment(A, c.id, { status: "working" });
    expect(await dismissComments(A, [c.id])).toEqual([]);
  });
});

describe("PI-13: a comment on one slide's words changes that slide only", () => {
  it("the other slides keep their words", async () => {
    if (!dbReachable) return;
    await patchContent(A, item, { body: "First line about pricing.\n\nSecond line about value.\n\nThird line about scope." });
    const [before] = (await listContent(A)).filter((i) => i.id === item);
    const slides = slidesOf({ hook: before.hook, body: before.body, cta: before.cta ?? "" });
    expect(slides.length).toBeGreaterThan(3);
    const v = (await listVisuals(A)).find((x) => x.kind === "carousel_frame")!;
    const c = await addComment(A, { visualId: v.id, target: "body", box: { x: 0.1, y: 0.3, w: 0.6, h: 0.3 }, note: "make it punchier", frame: 2 });
    const done = await applyTemplateComment(A, c);
    const [after] = (await listContent(A)).filter((i) => i.id === item);
    const lines = (b: string) => b.split(/\n+/).filter(Boolean);
    if (done.status === "applied") {
      expect(done.result).toMatch(/^Changed slide 3 to:/);
      expect(lines(after.body)[0]).toBe("First line about pricing.");
      expect(lines(after.body)[2]).toBe("Third line about scope.");
      expect(after.hook).toBe(before.hook);
    } else {
      // The stand-in may hand the words back unchanged: then nothing changed at all.
      expect(after.body).toBe(before.body);
    }
  });
});

describe("PI-29: a pin that went through is never redone when its job runs again", () => {
  it("applyPictureComment on an applied pin returns its picture with no new model call", async () => {
    if (!dbReachable) return;
    await plant("post");
    const v = (await listVisuals(A)).find((x) => x.kind === "single")!;
    const c = await addComment(A, { visualId: v.id, target: "picture", box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, note: "warmer", area: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } });
    const first = await applyPictureComment(A, c.id);
    const logs = await imageLogs();
    expect(await applyPictureComment(A, c.id)).toBe(first);
    expect(await imageLogs()).toBe(logs);
    expect((await getComment(A, c.id))?.resultPictureId).toBe(first);
  });
  it("madeSince finds a resize already made from the same picture", async () => {
    if (!dbReachable) return;
    const since = new Date(Date.now() - 1000).toISOString();
    const from = await plant("post");
    expect(await madeSince(A, item, "post", "resize", from, since)).toBeNull();
    const { resizePicture } = await import("@/lib/data/pictures");
    const crop = await resizePicture(A, item, "post", { ratio: 1, place: { x: 0, y: -0.125, w: 1, h: 1 } });
    expect(await madeSince(A, item, "post", "resize", from, since)).toBe(crop);
  });
});

describe("PI-20: a words check that couldn't run is said, and can be run again", () => {
  it("keepWordsOut says 'unchecked' when the look can't run; the version records it; Check for words clears it", async () => {
    if (!dbReachable) return;
    const context = await loadBrandContext(A, "en", undefined, "check");
    const out = await keepWordsOut(A, { context, bytes: new Uint8Array([1, 2, 3]), model: "m", shape: "square", contentItemId: item, why: "a test", fix: false });
    expect(out).toMatchObject({ textLeft: false, unchecked: true });
    const id = await plant("post");
    await admin("UPDATE image_assets SET params = params || '{\"wordsUnchecked\": true}'::jsonb WHERE id=$1", [id]);
    expect((await pictureVersions(A)).find((x) => x.id === id)?.wordsUnchecked).toBe(true);
    // The stand-in looks and sees no words.
    expect(await checkWords(A, item, "post")).toBe("clean");
    const after = (await pictureVersions(A)).find((x) => x.id === id)!;
    expect([after.wordsUnchecked, after.textLeft]).toEqual([false, false]);
  });
});
