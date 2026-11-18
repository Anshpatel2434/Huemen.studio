/**
 * Words in a picture that must have none (2026-11-19). A picture drawn to sit
 * under live text came back with "qualified" printed on a cup label; now a
 * vision model looks after drawing (picture_text_check, through the facade)
 * and words are erased, looked at again, redrawn once, or kept and flagged.
 *
 *   - the task: in the catalogue, its schema, its stand-in, its temperature
 *   - the boxes: fractions, thousandths or pixels, grown, capped, clipped
 *   - the mask: only the boxes may change, never an excepted part
 *   - the flow, with fakes standing in for the models:
 *       words found -> erased (outside the boxes, the drawn picture byte for byte) -> clean
 *       words stay after the erase -> drawn again once -> clean
 *       words stay after that too -> kept, flagged for the board, picture_text_left
 *       vision unavailable -> the picture is kept as drawn, nothing erased
 *   - each model call is a generation_logs row
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi, onTestFinished } from "vitest";
import { Pool } from "pg";
import sharp from "sharp";
import { appPool } from "@/db/pool";
import { createProject, unlockStage, type ProjectScope } from "@/lib/data/projects";
import { generateContent } from "@/lib/data/content";
import { deleteVisuals, generateVisuals } from "@/lib/data/pipeline";
import { designOf, drawPicture, pictureVersions, redrawArea } from "@/lib/data/pictures";
import { pictureTextCheck, TASKS } from "@/lib/ai/tasks";
import { TEMPLATE_CATALOG } from "@/lib/ai/template-defaults";
import { temperatureFor, TEMPERATURE } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/errors";
import { mockImageProvider, mockTextProvider } from "@/lib/ai/providers/mock";
import { boxesWithin, MAX_WORD_BOXES, MAX_WORD_ERASES, WORD_PAD, WORD_PAD_MIN, WORDS_NOTICE, wordBoxes, wordGroups } from "@/lib/visual/picture-words";
import { boxesMask, maskHasArea } from "@/lib/visual/region";
import { storage } from "@/lib/storage";
import type { ImageGenRequest, ImageGenResult } from "@/lib/ai/types";

describe("the picture_text_check task", () => {
  it("is in the catalogue as an editable template, runs as a judgement, and the stand-in sees no words", () => {
    expect(TASKS.picture_text_check).toBe(pictureTextCheck);
    const entry = TEMPLATE_CATALOG.find((t) => t.key === "picture_text_check")!;
    expect(entry.group).toBe("task");
    expect(entry.defaultBody).toBe(pictureTextCheck.template);
    expect(entry.about).toMatch(/vision model/);
    expect(temperatureFor("picture_text_check")).toBe(TEMPERATURE.judge);
    expect(pictureTextCheck.schema.parse(pictureTextCheck.mock(""))).toEqual({ hasText: false, boxes: [] });
    // The shape asked for is in the code-owned contract, never only in the editable template.
    expect(pictureTextCheck.contract).toMatch(/thousandths of the picture/);
    expect(`${pictureTextCheck.template}\n${pictureTextCheck.contract}`).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("its schema takes boxes as numbers and refuses anything else", () => {
    const ok = pictureTextCheck.schema.safeParse({ hasText: true, boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }] });
    expect(ok.success).toBe(true);
    expect(pictureTextCheck.schema.safeParse({ hasText: "yes", boxes: [] }).success).toBe(false);
    expect(pictureTextCheck.schema.safeParse({ hasText: true }).success).toBe(false);
    expect(pictureTextCheck.schema.safeParse({ hasText: true, boxes: [{ x: "0.1", y: 0, w: 1, h: 1 }] }).success).toBe(false);
  });
});

describe("where the words are (pure)", () => {
  const sent = { width: 768, height: 768 };
  it("reads fractions as asked, grows each box by WORD_PAD of itself (at least WORD_PAD_MIN), inside the picture", () => {
    const [b] = wordBoxes([{ x: 0.4, y: 0.5, w: 0.2, h: 0.1 }], sent);
    expect(b.x).toBeCloseTo(0.4 - 0.2 * WORD_PAD, 6);
    expect(b.w).toBeCloseTo(0.2 * (1 + 2 * WORD_PAD), 6);
    expect(b.y).toBeCloseTo(0.5 - 0.1 * WORD_PAD, 6);
    // A tiny label gets the minimum pad.
    const [t] = wordBoxes([{ x: 0.5, y: 0.5, w: 0.01, h: 0.01 }], sent);
    expect(t.w).toBeCloseTo(0.01 + 2 * WORD_PAD_MIN, 6);
    // At the corner it stays inside.
    const [c] = wordBoxes([{ x: 0, y: 0.95, w: 0.1, h: 0.05 }], sent);
    expect(c.x).toBe(0);
    expect(c.y + c.h).toBeCloseTo(1, 6);
  });

  it("reads thousandths (as asked: how Qwen's vision models place boxes), fractions, and pixels past 1000", () => {
    const [k] = wordBoxes([{ x: 400, y: 500, w: 200, h: 100 }], sent);
    expect(k.x).toBeCloseTo(0.4 - 0.2 * WORD_PAD, 6);
    expect(k.y).toBeCloseTo(0.5 - 0.1 * WORD_PAD, 6);
    const [px] = wordBoxes([{ x: 1200, y: 600, w: 600, h: 300 }], { width: 2400, height: 3000 });
    expect(px.x).toBeCloseTo(0.5 - 0.25 * WORD_PAD, 6);
    expect(px.y).toBeCloseTo(0.2 - 0.1 * WORD_PAD, 6);
    // Live (2026-11-19): a box at the very bottom edge, starting off the picture, is not a word.
    expect(wordBoxes([{ x: 632, y: 1000, w: 167, h: 47 }], sent)).toEqual([]);
  });

  it("drops what can't be read or covers most of the picture, and keeps at most MAX_WORD_BOXES", () => {
    expect(wordBoxes(null, sent)).toEqual([]);
    expect(wordBoxes([{ x: "a", y: 0, w: 0.1, h: 0.1 }, { x: 0, y: 0, w: 0, h: 0.1 }, { x: 0, y: 0, w: 0.9, h: 0.9 }], sent)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({ x: 0.05 * i, y: 0.1, w: 0.03, h: 0.03 }));
    expect(wordBoxes(many, sent)).toHaveLength(MAX_WORD_BOXES);
  });

  it("words close together are erased in one call, words far apart each in their own (a close-up per group), at most MAX_WORD_ERASES", () => {
    // Live 2026-11-19: "qualified" on the cup, mirrored words on its far side, a false find in a shadow.
    const qualified = { x: 0.302, y: 0.478, w: 0.196, h: 0.058 };
    const mirrored = { x: 0.258, y: 0.338, w: 0.224, h: 0.064 };
    const shadow = { x: 0.528, y: 0.708, w: 0.224, h: 0.058 };
    const groups = wordGroups([qualified, shadow, mirrored]);
    expect(groups).toEqual([[qualified, mirrored], [shadow]]);
    const scattered = Array.from({ length: 5 }, (_, i) => ({ x: 0.2 * i, y: 0.2 * i, w: 0.05, h: 0.05 }));
    expect(wordGroups(scattered)).toHaveLength(MAX_WORD_ERASES);
    expect(wordGroups([])).toEqual([]);
  });

  it("an area edit only erases inside its own area", () => {
    const area = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    expect(boxesWithin([{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }], area)).toEqual([]);
    const [b] = boxesWithin([{ x: 0.4, y: 0.6, w: 0.2, h: 0.1 }], area);
    expect(b.x).toBeCloseTo(0.5, 6);
    expect(b.w).toBeCloseTo(0.1, 6);
  });

  it("the board's notice is plain and points at Erase", () => {
    expect(WORDS_NOTICE).toBe("This picture may show some words. Use Erase to remove them.");
    expect(WORDS_NOTICE).not.toMatch(/\bAI\b/);
  });

  it("the mask is open only inside the boxes, and never over the part that must not change", async () => {
    const mask = await boxesMask([{ x: 0, y: 0, w: 0.5, h: 0.5 }], 100, 100, { left: 0, top: 0, width: 25, height: 100 });
    const { data } = await sharp(Buffer.from(mask)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const open = (x: number, y: number) => data[(y * 100 + x) * 4 + 3] < 128;
    expect(open(30, 10)).toBe(true);
    expect(open(10, 10)).toBe(false); // excepted
    expect(open(60, 10)).toBe(false); // outside the box
    expect(await maskHasArea(mask)).toBe(true);
    expect(await maskHasArea(await boxesMask([{ x: 0, y: 0, w: 0.2, h: 0.2 }], 100, 100, { left: 0, top: 0, width: 100, height: 100 }))).toBe(false);
  });
});

// ---- the flow, against the database, with fakes for the models ------------------------------

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
  const [t] = await admin<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", ["Picture words (test)"]);
  const [u] = await admin<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','active') RETURNING id", [t.id, "picture-words@test.local"]);
  tenants.push(t.id);
  const w = { tenantId: t.id, userId: u.id, isPlatformAdmin: false };
  A = { ...w, projectId: await createProject(w, "Picture words") };
  item = await generateContent(A, { format: "linkedin_post", topic: "pricing" });
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

type Said = { hasText: boolean; boxes: { x: number; y: number; w: number; h: number }[] } | Error;
const WORD = { x: 0.3, y: 0.4, w: 0.2, h: 0.06 };

// The stand-ins as they are, taken once: a second spy in one test must not wrap the first.
const realStructured = mockTextProvider.structured.bind(mockTextProvider);
const realGenerate = mockImageProvider.generate.bind(mockImageProvider);
const realEdit = mockImageProvider.edit.bind(mockImageProvider);

/** The vision model, faked: each look takes the next answer (the last one repeats). Every other task runs as before. */
function fakeVision(answers: Said[]) {
  const real = realStructured;
  let looks = 0;
  const spy = vi.spyOn(mockTextProvider, "structured").mockImplementation(async (req, model, schema) => {
    if (req.templateKey !== "picture_text_check") return real(req, model, schema);
    // A look always carries the picture (vision).
    expect(req.images?.length).toBe(1);
    const said = answers[Math.min(looks++, answers.length - 1)];
    if (said instanceof Error) throw said;
    return { data: schema.parse(said), model, tokensIn: 10, tokensOut: 10 };
  });
  onTestFinished(() => spy.mockRestore());
  return { looks: () => looks };
}

/** The image models, watched: what was drawn (in order) and how many erases ran. */
function watchImages() {
  const drawn: Uint8Array[] = [];
  let erases = 0;
  const kinds: (string | undefined)[] = [];
  const gen = realGenerate;
  const edit = realEdit;
  const g = vi.spyOn(mockImageProvider, "generate").mockImplementation(async (req: ImageGenRequest, model: string): Promise<ImageGenResult> => {
    const out = await gen(req, model);
    drawn.push(out.bytes);
    return out;
  });
  const e = vi.spyOn(mockImageProvider, "edit").mockImplementation(async (req, model) => {
    if (req.intent === "erase") { erases++; kinds.push(req.erase); }
    return edit(req, model);
  });
  onTestFinished(() => { g.mockRestore(); e.mockRestore(); });
  return { drawn, erases: () => erases, kinds };
}

const logs = async (kind: "text" | "image") =>
  (await admin<{ n: number }>("SELECT count(*)::int AS n FROM generation_logs WHERE tenant_id=$1 AND kind=$2", [A.tenantId, kind]))[0].n;
const rowOf = async (id: string) =>
  (await admin<{ storage_key: string; params: { op?: string; textLeft?: boolean } }>("SELECT storage_key, params FROM image_assets WHERE id=$1", [id]))[0];
const raw = async (png: Uint8Array) => (await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));

describe("a new picture under live text is checked for words", () => {
  it("words found are erased, only inside their boxes, and a second look finds them gone: one clean version", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const vision = fakeVision([{ hasText: true, boxes: [WORD] }, { hasText: false, boxes: [] }]);
    const img = watchImages();
    const [text0, image0] = [await logs("text"), await logs("image")];
    const id = await drawPicture(A, item, "quote", "live_text");
    expect(vision.looks()).toBe(2);
    expect(img.drawn).toHaveLength(1);
    expect(img.erases()).toBe(1);
    // Only the words go (the provider is told so), not everything in the boxes.
    expect(img.kinds).toEqual(["words"]);
    const row = await rowOf(id);
    expect(row.params.op).toBe("draw");
    expect(row.params.textLeft).toBeUndefined();
    expect((await pictureVersions(A)).find((v) => v.id === id)?.textLeft).toBe(false);
    // Each model call is logged: the brief and two looks (text), the draw and the erase (image).
    expect(await logs("text")).toBe(text0 + 3);
    expect(await logs("image")).toBe(image0 + 2);
    // Outside the word's box the saved picture is the drawn one, byte for byte; inside it changed.
    const before = await raw(img.drawn[0]);
    const after = await raw((await storage().get(row.storage_key))!.data);
    const [W, H] = [before.info.width, before.info.height];
    const [grown] = wordBoxes([WORD], { width: 768, height: 768 });
    let outside = 0, inside = 0;
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        const i = (y * W + x) * 4;
        const differs = [0, 1, 2, 3].some((c) => before.data[i + c] !== after.data[i + c]);
        const inBox = x >= Math.floor(grown.x * W) && x < Math.ceil((grown.x + grown.w) * W) && y >= Math.floor(grown.y * H) && y < Math.ceil((grown.y + grown.h) * H);
        if (differs && !inBox) outside++;
        if (differs && inBox) inside++;
      }
    }
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(0);
  });

  it("words that stay after the erase: the picture is drawn again once, and that clean draw is kept", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const vision = fakeVision([{ hasText: true, boxes: [WORD] }, { hasText: true, boxes: [WORD] }, { hasText: false, boxes: [] }]);
    const img = watchImages();
    const id = await drawPicture(A, item, "quote", "live_text");
    expect(vision.looks()).toBe(3);
    expect(img.drawn).toHaveLength(2);
    expect(img.erases()).toBe(1);
    expect((await rowOf(id)).params.textLeft).toBeUndefined();
    // The redraw is what was saved.
    const saved = (await storage().get((await rowOf(id)).storage_key))!.data;
    expect(Buffer.compare(Buffer.from(saved), Buffer.from(img.drawn[1]))).toBe(0);
  });

  it("words still there after the redraw: kept, flagged for the board's notice", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const info = vi.spyOn(await import("@/lib/observability/log").then((m) => m.logger), "info");
    onTestFinished(() => info.mockRestore());
    fakeVision([{ hasText: true, boxes: [WORD] }]);
    const img = watchImages();
    const id = await drawPicture(A, item, "quote", "live_text");
    expect(img.drawn).toHaveLength(2);
    expect(img.erases()).toBe(1);
    expect((await rowOf(id)).params.textLeft).toBe(true);
    expect((await pictureVersions(A)).find((v) => v.id === id)).toMatchObject({ textLeft: true, op: "draw" });
    expect((await designOf(A, item))!.pictures.quote!.id).toBe(id);
    expect(info.mock.calls.some(([msg]) => msg === "picture_text_left")).toBe(true);
  });

  it("vision unavailable (down, or out of allowance for the day): the picture is kept as drawn, nothing erased, no flag", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    for (const down of [
      new ProviderError("server", "The vision model is down.", false),
      new ProviderError("rate_limit", "Rate limit reached: tokens per day (TPD).", false, { window: "day", retryAfterSeconds: 3600 }),
    ]) {
      const vision = fakeVision([down]);
      const img = watchImages();
      const text0 = await logs("text");
      const id = await drawPicture(A, item, "quote", "live_text");
      expect(vision.looks()).toBe(1);
      expect(img.erases()).toBe(0);
      expect(img.drawn).toHaveLength(1);
      const row = await rowOf(id);
      expect(row.params.textLeft).toBeUndefined();
      const saved = (await storage().get(row.storage_key))!.data;
      expect(Buffer.compare(Buffer.from(saved), Buffer.from(img.drawn[0]))).toBe(0);
      // The failed look is still in the audit trail.
      const [last] = await admin<{ status: string }>("SELECT status FROM generation_logs WHERE tenant_id=$1 AND kind='text' ORDER BY created_at DESC LIMIT 1", [A.tenantId]);
      expect(last.status).toBe("error");
      expect(await logs("text")).toBe(text0 + 2); // the brief, and the look that failed
    }
  });

  it("a picture with its heading drawn in is never checked (its words are wanted)", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const vision = fakeVision([{ hasText: true, boxes: [WORD] }]);
    watchImages();
    await drawPicture(A, item, "quote", "with_text");
    expect(vision.looks()).toBe(0);
  });

  it("an area change that drew words erases them inside its area only; words outside it are flagged, never touched", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    fakeVision([{ hasText: false, boxes: [] }]);
    watchImages();
    const start = await drawPicture(A, item, "post", "live_text");
    const area = { x: 0.5, y: 0.5, w: 0.4, h: 0.4 };
    // Words inside the changed area, then none.
    let vision = fakeVision([{ hasText: true, boxes: [{ x: 0.6, y: 0.6, w: 0.1, h: 0.05 }] }, { hasText: false, boxes: [] }]);
    let img = watchImages();
    const changed = await redrawArea(A, item, "post", area, "a cup on the table");
    expect(vision.looks()).toBe(2);
    expect(img.erases()).toBe(1);
    expect((await rowOf(changed)).params.textLeft).toBeUndefined();
    expect(changed).not.toBe(start);
    // Words only outside the area: nothing erased (the area guarantee), the version is flagged.
    vision = fakeVision([{ hasText: true, boxes: [{ x: 0.05, y: 0.05, w: 0.1, h: 0.05 }] }]);
    img = watchImages();
    const again = await redrawArea(A, item, "post", area, "a plant instead");
    expect(vision.looks()).toBe(1);
    expect(img.erases()).toBe(0);
    expect(img.drawn).toHaveLength(0);
    expect((await rowOf(again)).params.textLeft).toBe(true);
  });
});
