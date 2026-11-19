/**
 * The picture tools on the Visual board (2026-11-18), the parts that need no
 * database:
 *
 *   - what was drawn is capped and clamped before it is kept or used
 *   - Erase's guarantee: only brushed pixels can change, byte for byte
 *   - Resize's geometry: the picture set in a bigger frame, the original
 *     pasted back, a crop where the frame is covered, and the drift check
 *   - what each kind of change sends the image service (Runpod, against a
 *     fake HTTP layer) and what the stand-in does with it
 *   - Remove background: the "no clear subject" guard, and whether the tool
 *     can run at all
 *
 * The database half (several pins in one job, the versions, the cap) is in
 * tests/pictures.test.ts.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  cleanStrokes, driftOf, keepInsideMask, keepOriginal, placeOnCanvas, regionMask, seamOf, strokeMask, strokesBox, strokesOverlay, visiblePart,
} from "@/lib/visual/region";
import {
  clearSubject, coversFrame, CUTOUT_COVERAGE, MAX_STROKES, MAX_STROKE_POINTS, MIN_EXTEND_COVER, STROKE_WIDTH, type Stroke,
} from "@/lib/visual/picture-tools";
import { ERASE_PROMPTS, ERASE_VARIANT, ERASE_WORDS_PROMPT, EXTEND_PROMPT, fillBrushed, markupPrompt, runpodImageProvider, type FetchLike } from "@/lib/ai/providers/runpod-image";
import { openaiImageProvider } from "@/lib/ai/providers/openai-image";
import { mockCutoutProvider, mockImageProvider } from "@/lib/ai/providers/mock";
import { CUTOUT_NO_MODEL, CUTOUT_OFF, cutoutStatus, selectCutoutProvider } from "@/lib/ai/cutout";
import { applyMatte, cutoutInput } from "@/lib/ai/providers/cutout-onnx";
import { AiConfigError } from "@/lib/ai/errors";
import { canvasFor, DRIFT_LIMIT, EXTEND_MATTE, MARKS_COLOUR, planResize, PictureError, SEAM_LIMIT } from "@/lib/data/pictures";
import { parseDesign } from "@/lib/visual/design";
import { parseEnv } from "@/lib/env";
import type { BrandContext } from "@/lib/context/context-builder";

const ctx = { serialized: "", guardrails: { doWords: [], dontWords: [] } } as unknown as BrandContext;

const pixels = async (png: Uint8Array | Buffer) => {
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  return { data, width: info.width, height: info.height, at };
};

/** A picture with something different at every pixel, so a moved or changed pixel always shows. */
async function patterned(width: number, height: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 7 + y * 3) % 256;
      raw[i + 1] = (x * 2 + y * 11) % 200;
      raw[i + 2] = ((x >> 3) * 40 + (y >> 3) * 25) % 256;
    }
  }
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer());
}
const solid = async (width: number, height: number, background: string) =>
  new Uint8Array(await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer());

const BRUSH: Stroke[] = [{ w: 0.12, pts: [[0.3, 0.5], [0.7, 0.5]] }];

describe("what was drawn is capped before it is used", () => {
  it("keeps at most 12 strokes of 64 points, thins a long line without losing its ends, and clamps everything into the picture", () => {
    const long = Array.from({ length: 500 }, (_, i) => [i / 499, 0.25] as [number, number]);
    const many = Array.from({ length: 30 }, (_, i) => ({ w: 0.01, pts: [[0.1, i / 30], [0.9, i / 30]] }));
    const out = cleanStrokes([{ w: 0.05, pts: long }, ...many]);
    expect(out).toHaveLength(MAX_STROKES);
    expect(out[0].pts).toHaveLength(MAX_STROKE_POINTS);
    expect(out[0].pts[0]).toEqual([0, 0.25]);
    expect(out[0].pts.at(-1)).toEqual([1, 0.25]);

    const odd = cleanStrokes([
      { w: 5, pts: [[-3, 0.5], [9, 2]] }, // far too wide, points outside
      { w: 0, pts: [[0.5, 0.5]] }, // a dot, thinner than allowed
      { w: "x", pts: [["a", 1], [0.2, 0.2]] }, // a bad width and a bad point
      { w: 0.01, pts: [] }, // nothing drawn
      "not a stroke", null, { pts: "no" },
    ]);
    expect(odd).toEqual([
      { w: STROKE_WIDTH.max, pts: [[0, 0.5], [1, 1]] },
      { w: STROKE_WIDTH.min, pts: [[0.5, 0.5]] },
      { w: expect.any(Number), pts: [[0.2, 0.2]] },
    ]);
    expect(cleanStrokes("nope")).toEqual([]);
    expect(cleanStrokes(null)).toEqual([]);
    // What is kept is small enough for the row (migration 0025 caps the column at 32 KB).
    const full = cleanStrokes(Array.from({ length: 40 }, () => ({ w: 0.06, pts: Array.from({ length: 400 }, (_, i) => [0.123456 + i / 1000, 0.654321]) })));
    expect(JSON.stringify(full).length).toBeLessThan(32_768);
  });

  it("boxes the strokes with their own width, a pad measured on the shorter side, and never leaves the picture", () => {
    expect(strokesBox([])).toBeNull();
    const line: Stroke[] = [{ w: 0.1, pts: [[0.4, 0.5], [0.6, 0.5]] }];
    expect(strokesBox(line)).toEqual({ x: expect.closeTo(0.35, 5), y: expect.closeTo(0.45, 5), w: expect.closeTo(0.3, 5), h: expect.closeTo(0.1, 5) });
    expect(strokesBox(line, 0.05)).toEqual({ x: expect.closeTo(0.3, 5), y: expect.closeTo(0.4, 5), w: expect.closeTo(0.4, 5), h: expect.closeTo(0.2, 5) });
    // A picture twice as wide as it is tall: the same pad is half as much of the width.
    expect(strokesBox(line, 0.05, 2)!.w).toBeCloseTo(0.2 + 2 * 0.05, 5);
    expect(strokesBox(line, 0.05, 2)!.h).toBeCloseTo(0.2, 5);
    // A dot is still somewhere, and a stroke at the edge stays inside.
    const dot = strokesBox([{ w: 0.004, pts: [[0.5, 0.5]] }])!;
    expect(dot.w).toBeGreaterThanOrEqual(0.0199);
    const corner = strokesBox([{ w: 0.2, pts: [[0.99, 0.99]] }], 0.1)!;
    expect(corner.x + corner.w).toBeLessThanOrEqual(1.000001);
    expect(corner.y + corner.h).toBeLessThanOrEqual(1.000001);
  });
});

describe("Erase's guarantee", () => {
  it("the brushed mask is transparent exactly where the brush went", async () => {
    const m = await pixels(await strokeMask(BRUSH, 200, 100));
    expect([m.width, m.height]).toEqual([200, 100]);
    expect(m.at(100, 50)[3]).toBe(0); // on the line
    expect(m.at(60, 50)[3]).toBe(0); // its round start
    expect(m.at(100, 44)[3]).toBe(0); // inside its width (12 px on a 100 px side)
    expect(m.at(100, 40)[3]).toBe(255); // just outside it
    expect(m.at(10, 10)[3]).toBe(255);
    expect(m.at(190, 50)[3]).toBe(255);
  });

  it("every pixel that was not brushed is the original's, byte for byte; brushed pixels take the edit", async () => {
    const original = await patterned(200, 160);
    const edited = await solid(64, 80, "#fa0000"); // another size, changed everywhere
    const mask = await strokeMask(BRUSH, 200, 160);
    const out = await pixels(await keepInsideMask(original, edited, mask, 6));
    const was = await pixels(original);
    const m = await pixels(mask);
    expect([out.width, out.height]).toEqual([200, 160]);
    let outsideChanged = 0;
    let insideChanged = 0;
    let inside = 0;
    for (let i = 0; i < 200 * 160; i++) {
      const brushed = m.data[i * 4 + 3] < 128;
      const differs = [0, 1, 2, 3].some((c) => was.data[i * 4 + c] !== out.data[i * 4 + c]);
      if (brushed) inside++;
      if (differs && !brushed) outsideChanged++;
      if (differs && brushed) insideChanged++;
    }
    expect(outsideChanged).toBe(0);
    expect(inside).toBeGreaterThan(1000);
    expect(insideChanged).toBeGreaterThan(inside * 0.7);
    // The middle of the brushed line is the edit, whole.
    expect(out.at(100, 80).slice(0, 3)).toEqual([250, 0, 0]);
    // With no soft edge, every brushed pixel is the edit.
    const hard = await pixels(await keepInsideMask(original, edited, mask, 0));
    expect(hard.at(62, 80).slice(0, 3)).toEqual([250, 0, 0]);
  });

  it("a mask with nothing brushed changes nothing at all", async () => {
    const original = await patterned(80, 60);
    const untouched = await keepInsideMask(original, await solid(80, 60, "#00ff00"), await strokeMask([], 80, 60));
    expect(Buffer.compare((await pixels(untouched)).data, (await pixels(original)).data)).toBe(0);
  });

  it("the marks are drawn in their colour on a transparent sheet the picture's size", async () => {
    const sheet = await pixels(await strokesOverlay([{ w: 0.05, pts: [[0.2, 0.5], [0.8, 0.5]] }], 200, 100, MARKS_COLOUR));
    expect([sheet.width, sheet.height]).toEqual([200, 100]);
    expect(sheet.at(100, 50)).toEqual([255, 0, 255, 255]);
    expect(sheet.at(100, 10)[3]).toBe(0);
  });
});

describe("Resize's geometry", () => {
  it("says a frame is covered only when the picture reaches all four sides", () => {
    expect(coversFrame({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(coversFrame({ x: -0.2, y: -0.1, w: 1.4, h: 1.3 })).toBe(true);
    expect(coversFrame({ x: 0.001, y: 0, w: 0.999, h: 1 })).toBe(true); // within a rounding
    expect(coversFrame({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
    expect(coversFrame({ x: 0, y: 0, w: 1, h: 0.8 })).toBe(false);
    expect(coversFrame({ x: -0.5, y: 0, w: 1.2, h: 1 })).toBe(false);
  });

  it("sets the picture in the new frame on a flat matte, cut where it runs past the frame", async () => {
    const source = await patterned(100, 80);
    const was = await pixels(source);
    const canvas = await pixels(await placeOnCanvas(source, { width: 200, height: 120 }, { left: 50, top: 20, width: 100, height: 80 }, EXTEND_MATTE));
    expect([canvas.width, canvas.height]).toEqual([200, 120]);
    expect(canvas.at(10, 10).slice(0, 3)).toEqual([0, 255, 0]);
    expect(canvas.at(199, 119).slice(0, 3)).toEqual([0, 255, 0]);
    for (const [x, y] of [[0, 0], [99, 79], [37, 41]]) expect(canvas.at(50 + x, 20 + y)).toEqual(was.at(x, y));
    // Starting before the frame: the part that is outside is cut away, the rest is in place.
    const cut = await pixels(await placeOnCanvas(source, { width: 120, height: 120 }, { left: -40, top: 20, width: 100, height: 80 }, EXTEND_MATTE));
    expect(cut.at(0, 20)).toEqual(was.at(40, 0));
    expect(cut.at(59, 99)).toEqual(was.at(99, 79));
    expect(cut.at(60, 60).slice(0, 3)).toEqual([0, 255, 0]);
    expect(visiblePart({ left: -40, top: 20, width: 100, height: 80 }, { width: 120, height: 120 })).toEqual({ left: 0, top: 20, width: 60, height: 80 });
    expect(visiblePart({ left: 300, top: 0, width: 10, height: 10 }, { width: 120, height: 120 })).toBeNull();
  });

  it("pastes the original back over its place: identical inside, the model's outside, soft only on the sides that border new area", async () => {
    const source = await patterned(100, 80);
    const was = await pixels(source);
    const extended = await solid(200, 120, "#c80000"); // the model's answer: wrong everywhere
    const place = { left: 0, top: 20, width: 100, height: 80 }; // flush with the frame's left side
    const out = await pixels(await keepOriginal(extended, source, place, 10));
    expect([out.width, out.height]).toEqual([200, 120]);
    // The new area is the model's.
    expect(out.at(150, 60).slice(0, 3)).toEqual([200, 0, 0]);
    expect(out.at(50, 5).slice(0, 3)).toEqual([200, 0, 0]);
    // Inside the soft edge, every pixel is the original's.
    let moved = 0;
    for (let y = 10; y < 70; y++) {
      for (let x = 0; x < 90; x++) {
        const a = out.at(x, 20 + y);
        const b = was.at(x, y);
        if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) moved++;
      }
    }
    expect(moved).toBe(0);
    // The left side sits on the frame's own edge: not faded. The right side borders new area: faded.
    expect(out.at(0, 60).slice(0, 3)).toEqual(was.at(0, 40).slice(0, 3));
    expect(out.at(99, 60).slice(0, 3)).not.toEqual(was.at(99, 40).slice(0, 3));
    // No soft edge at all: the whole place is the original.
    const hard = await pixels(await keepOriginal(extended, source, place, 0));
    expect(hard.at(99, 60).slice(0, 3)).toEqual(was.at(99, 40).slice(0, 3));
    expect(hard.at(100, 60).slice(0, 3)).toEqual([200, 0, 0]);
  });

  it("the drift check passes an answer that left the picture where it was, and catches one that moved it", async () => {
    const source = new Uint8Array(await sharp(Buffer.from(await patterned(160, 128))).blur(6).png().toBuffer());
    const canvas = { width: 320, height: 192 };
    const place = { left: 80, top: 32, width: 160, height: 128 };
    const still = await placeOnCanvas(source, canvas, place, "#808080");
    expect(await driftOf(still, source, place)).toBeLessThan(0.005);
    // The same scene, a shade brighter everywhere: a colour shift is not a move.
    const brighter = new Uint8Array(await sharp(Buffer.from(still)).linear(1, 12).png().toBuffer());
    expect(await driftOf(brighter, source, place)).toBeLessThan(DRIFT_LIMIT);
    // The model slid the picture a quarter of its width to the right.
    const slid = await placeOnCanvas(source, canvas, { ...place, left: place.left + 40 }, "#808080");
    expect(await driftOf(slid, source, place)).toBeGreaterThan(DRIFT_LIMIT);
  });

  it("the join check passes a new area that carries on from the picture's edge, and catches one with a line at the join", async () => {
    const place = { left: 120, top: 0, width: 160, height: 200 }; // on a 400 x 200 canvas
    // A smooth scene: the picture is a part of it, the model drew the rest of the same scene.
    const scene = new Uint8Array(await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><defs><linearGradient id="g"><stop offset="0" stop-color="#d8c8b0"/><stop offset="1" stop-color="#8a7a66"/></linearGradient></defs><rect width="400" height="200" fill="url(#g)"/><rect y="120" width="400" height="80" fill="#efe9df"/></svg>')).png().toBuffer());
    const source = new Uint8Array(await sharp(Buffer.from(scene)).extract(place).png().toBuffer());
    expect(await seamOf(await keepOriginal(scene, source, place), place)).toBeLessThan(SEAM_LIMIT);
    // The model drew the right side a shade darker, its table edge higher: a line down the join.
    const off = new Uint8Array(await sharp(Buffer.from(scene)).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="200"><rect width="120" height="200" fill="#6f6252"/><rect y="90" width="120" height="110" fill="#f6f1ea"/></svg>'), left: 280, top: 0 }]).png().toBuffer());
    expect(await seamOf(await keepOriginal(off, source, place), place)).toBeGreaterThan(SEAM_LIMIT);
    // A picture's own edges inside it are not a join: only the sides that border new area are looked at.
    expect(await seamOf(scene, { left: 0, top: 0, width: 400, height: 200 })).toBe(0);
  });

  it("plans a crop in the picture's own pixels and an extension on a canvas of about a megapixel in multiples of 16", () => {
    // A 4:5 picture to a square, filling the width: the top and bottom go.
    const crop = planResize({ ratio: 1, place: { x: 0, y: -0.125, w: 1, h: 0 } }, 1024, 1280);
    expect(crop.crop).toBe(true);
    expect(crop.place.h).toBeCloseTo(1.25, 5); // worked out from the picture's shape, not taken from the board
    expect(crop.cut).toEqual({ left: 0, top: 128, width: 1024, height: 1024 });
    // Zoomed in to the middle.
    expect(planResize({ ratio: 1, place: { x: -0.5, y: -0.75, w: 2, h: 9 } }, 1024, 1280).cut).toEqual({ left: 256, top: 384, width: 512, height: 512 });

    // The same picture to a wide frame, fitted by height in the middle: the sides are new.
    const wide = planResize({ ratio: 16 / 9, place: { x: 0.275, y: 0, w: 0.45, h: 1 } }, 1024, 1280);
    expect(wide.crop).toBe(false);
    expect(wide.canvas.width % 16).toBe(0);
    expect(wide.canvas.height % 16).toBe(0);
    expect(wide.canvas.width * wide.canvas.height).toBeGreaterThan(0.85 * 1024 * 1024);
    expect(wide.canvas.width * wide.canvas.height).toBeLessThan(1.15 * 1024 * 1024);
    expect(wide.canvas.width / wide.canvas.height).toBeCloseTo(16 / 9, 1);
    expect(wide.placePx.height).toBe(wide.canvas.height);
    expect(wide.placePx.width / wide.placePx.height).toBeCloseTo(0.8, 2);
    for (const r of [0.4, 0.8, 1, 1.5, 2.5]) {
      const c = canvasFor(r);
      expect([c.width % 16, c.height % 16]).toEqual([0, 0]);
      expect(c.width / c.height).toBeCloseTo(r, 1);
    }
  });

  it("refuses a shape or a placing that can't be used, in plain words", () => {
    const at = (input: unknown) => {
      try {
        planResize(input as never, 1024, 1280);
        return "";
      } catch (e) {
        expect(e).toBeInstanceOf(PictureError);
        return (e as Error).message;
      }
    };
    expect(at({ ratio: 5, place: { x: 0, y: 0, w: 1, h: 1 } })).toMatch(/too tall or too wide/);
    expect(at({ ratio: Number.NaN, place: { x: 0, y: 0, w: 1, h: 1 } })).toMatch(/too tall or too wide/);
    expect(at({ ratio: 1, place: { x: 2, y: 0, w: 1, h: 1 } })).toMatch(/inside the new frame/);
    expect(at({ ratio: 1, place: { x: 0, y: 0, w: "wide", h: 1 } })).toMatch(/inside the new frame/);
    expect(at(null)).toMatch(/too tall or too wide/);
    // The picture would cover under 40% of the new frame: a new picture is the honest answer.
    expect(MIN_EXTEND_COVER).toBe(0.4);
    expect(at({ ratio: 2.5, place: { x: 0.35, y: 0, w: 0.3, h: 1 } })).toBe("Draw a new picture in this shape instead.");
    // A crop that changes nothing, and one too small to stay sharp.
    expect(at({ ratio: 0.8, place: { x: 0, y: 0, w: 1, h: 1 } })).toMatch(/already has that shape/);
    expect(at({ ratio: 1, place: { x: -3, y: -3, w: 7, h: 1 } })).toMatch(/too small/);
  });
});

// ---- what each kind of change sends the image service -------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fakeRunpod(answer: Buffer) {
  const calls: { url: string; input: Record<string, unknown> | null }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, input: init?.body ? (JSON.parse(String(init.body)) as { input: Record<string, unknown> }).input : null });
    if (url.endsWith("/runsync")) return json({ status: "COMPLETED", output: { result: "https://image.runpod.ai/x/out.png" } });
    // The answer comes back in the shape it was asked in, as the models do (an answer in another shape is cropped or refused: PI-24).
    const asked = calls.findLast((c) => c.input?.image)?.input?.image;
    if (!asked) return new Response(new Uint8Array(answer));
    const m = await sharp(Buffer.from(String(asked).split(",")[1], "base64")).metadata();
    return new Response(new Uint8Array(await sharp(answer).resize(m.width!, m.height!, { fit: "fill" }).png().toBuffer()));
  };
  return { f, calls };
}
const sent = async (input: Record<string, unknown> | null) => pixels(Buffer.from(String(input!.image).split(",")[1], "base64"));
const RUNPOD = { apiKey: "rk", timeoutMs: 5000, editModel: "qwen-image-edit", extendModel: "qwen-image-edit-2511" };

describe("Runpod: one request per kind of change", () => {
  it("erase (tint): the close-up shows the brushed area painted magenta, and the instruction names the paint", async () => {
    // "tint" is the default again since the live trials moved Erase to its own endpoint (a model that follows paint).
    expect(ERASE_VARIANT).toBe("tint");
    const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123" };
    expect(parseEnv(BASE).AI_IMAGE_ERASE_VARIANT).toBe("tint");
    expect(parseEnv(BASE).AI_IMAGE_ERASE_MODEL).toBe("google-nano-banana-2-edit");
    expect(parseEnv({ ...BASE, AI_IMAGE_ERASE_MODEL: "", AI_IMAGE_ERASE_VARIANT: "" }).AI_IMAGE_ERASE_MODEL).toBe("google-nano-banana-2-edit");
    const source = await solid(512, 512, "#113355");
    const mask = await strokeMask(BRUSH, 512, 512);
    const { f, calls } = fakeRunpod(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#777777" } }).png().toBuffer());
    const out = await runpodImageProvider({ ...RUNPOD, eraseVariant: "tint" }, f).edit({ context: ctx, prompt: "whatever the caller wrote", source, mask, intent: "erase" }, "qwen-image-t2i");
    expect(calls[0].url).toBe("https://api.runpod.ai/v2/qwen-image-edit/runsync");
    expect(calls[0].input!.prompt).toBe(ERASE_PROMPTS.tint);
    expect(String(calls[0].input!.prompt)).toMatch(/^Remove everything under the magenta paint and the paint itself; fill it with the surrounding background\/surface/);
    const shown = await sent(calls[0].input);
    // A close-up (not the whole picture), enlarged; its middle is the painted brush, its corner the picture.
    expect(Math.max(shown.width, shown.height)).toBeGreaterThanOrEqual(1000);
    const [r, g, b] = shown.at(shown.width >> 1, shown.height >> 1);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(40);
    expect(b).toBeGreaterThan(150);
    expect(shown.at(4, 4).slice(0, 3)).toEqual([0x11, 0x33, 0x55]);
    // The answer is pasted onto the picture itself: no paint anywhere in what comes back.
    const back = await pixels(out.bytes);
    expect([back.width, back.height]).toEqual([512, 512]);
    expect(back.at(256, 256).slice(0, 3)).toEqual([0x77, 0x77, 0x77]);
    expect(back.at(10, 10).slice(0, 3)).toEqual([0x11, 0x33, 0x55]);
    expect(out.model).toBe("qwen-image-edit");
  });

  it("erase runs on the erase endpoint when one is named, and on the edit endpoint when not", async () => {
    const source = await solid(512, 512, "#113355");
    const mask = await strokeMask(BRUSH, 512, 512);
    const answer = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#777777" } }).png().toBuffer();
    const one = fakeRunpod(answer);
    const out = await runpodImageProvider({ ...RUNPOD, eraseModel: "google-nano-banana-2-edit" }, one.f).edit({ context: ctx, prompt: "x", source, mask, intent: "erase" }, "m");
    expect(one.calls[0].url).toBe("https://api.runpod.ai/v2/google-nano-banana-2-edit/runsync");
    expect(one.calls[0].input).toMatchObject({ images: [expect.any(String)] });
    expect(out.model).toBe("google-nano-banana-2-edit");
    const two = fakeRunpod(answer);
    await runpodImageProvider(RUNPOD, two.f).edit({ context: ctx, prompt: "x", source, mask, intent: "erase" }, "m");
    expect(two.calls[0].url).toBe("https://api.runpod.ai/v2/qwen-image-edit/runsync");
  });

  it("erase (fill): what was brushed is already gone from the close-up, filled from around it, and the model is asked only to blend the patch", async () => {
    // A blue picture with a white rod where the brush goes.
    const rod = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#113355"/><rect x="246" y="150" width="20" height="200" fill="#ffffff"/></svg>');
    const source = new Uint8Array(await sharp(rod).png().toBuffer());
    const brush: Stroke[] = [{ w: 0.08, pts: [[0.5, 0.28], [0.5, 0.7]] }];
    const mask = await strokeMask(brush, 512, 512);
    const { f, calls } = fakeRunpod(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#777777" } }).png().toBuffer());
    await runpodImageProvider({ ...RUNPOD, eraseVariant: "fill" }, f).edit({ context: ctx, prompt: "x", source, mask, intent: "erase" }, "m");
    expect(calls[0].input!.prompt).toBe(ERASE_PROMPTS.fill);
    const shown = await sent(calls[0].input);
    // The middle of the close-up was the rod: now it is the blue around it, near enough.
    const [r, g, b] = shown.at(shown.width >> 1, shown.height >> 1);
    expect(Math.abs(r - 0x11)).toBeLessThan(24);
    expect(Math.abs(g - 0x33)).toBeLessThan(24);
    expect(Math.abs(b - 0x55)).toBeLessThan(24);
    // The fill leaves every unbrushed pixel as it was.
    const filled = await pixels(new Uint8Array(await fillBrushed(Buffer.from(source), mask, 512, 512)));
    expect(filled.at(10, 10).slice(0, 3)).toEqual([0x11, 0x33, 0x55]);
    expect(filled.at(256, 160).slice(0, 3)).not.toEqual([255, 255, 255]);
  });

  it("erase (clean): the close-up is sent as it is, and the instruction says the object in the middle", async () => {
    const source = await solid(512, 512, "#113355");
    const { f, calls } = fakeRunpod(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#777777" } }).png().toBuffer());
    await runpodImageProvider({ ...RUNPOD, eraseVariant: "clean" }, f).edit({ context: ctx, prompt: "x", source, mask: await strokeMask(BRUSH, 512, 512), intent: "erase" }, "m");
    expect(calls[0].input!.prompt).toBe(ERASE_PROMPTS.clean);
    expect(String(calls[0].input!.prompt)).toMatch(/^Remove the object in the middle of this image; fill it/);
    const shown = await sent(calls[0].input);
    expect(shown.at(shown.width >> 1, shown.height >> 1).slice(0, 3)).toEqual([0x11, 0x33, 0x55]);
    // Nothing brushed is nothing to erase.
    await expect(runpodImageProvider(RUNPOD, f).edit({ context: ctx, prompt: "x", source, mask: await strokeMask([], 512, 512), intent: "erase" }, "m")).rejects.toMatchObject({ kind: "bad_request" });
  });

  it("erase of words (a picture that must have none): the close-up goes unpainted and only writing is to go, whatever the variant", async () => {
    const source = await solid(512, 512, "#113355");
    const { f, calls } = fakeRunpod(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#777777" } }).png().toBuffer());
    await runpodImageProvider({ ...RUNPOD, eraseModel: "google-nano-banana-2-edit", eraseVariant: "tint" }, f)
      .edit({ context: ctx, prompt: "x", source, mask: await strokeMask(BRUSH, 512, 512), intent: "erase", erase: "words" }, "m");
    expect(calls[0].url).toBe("https://api.runpod.ai/v2/google-nano-banana-2-edit/runsync");
    expect(calls[0].input!.prompt).toBe(ERASE_WORDS_PROMPT);
    expect(String(calls[0].input!.prompt)).toMatch(/^Remove all writing from this image/);
    expect(String(calls[0].input!.prompt)).toMatch(/Change nothing else/);
    // No magenta: what is under the box is shown as it is.
    const shown = await sent(calls[0].input);
    expect(shown.at(shown.width >> 1, shown.height >> 1).slice(0, 3)).toEqual([0x11, 0x33, 0x55]);
  });

  it("markup: the marks are on the close-up, the instruction says to follow them and the note and then remove them", async () => {
    const source = await solid(512, 512, "#113355");
    const marks = await strokesOverlay([{ w: 0.02, pts: [[0.3, 0.5], [0.7, 0.5]] }], 512, 512, MARKS_COLOUR);
    const box = { x: 0.2, y: 0.3, w: 0.6, h: 0.4 };
    const { f, calls } = fakeRunpod(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#777777" } }).png().toBuffer());
    const out = await runpodImageProvider(RUNPOD, f).edit(
      { context: ctx, prompt: "Change only the marked area: make the circled cup blue\nKeep everything else exactly as it is.\nNo words, letters or logos.", source, mask: await regionMask(box, 512, 512, 0), intent: "area", marks },
      "m",
    );
    const prompt = String(calls[0].input!.prompt);
    expect(prompt).toContain("Follow the hand-drawn marks and this note: make the circled cup blue.");
    expect(prompt).toMatch(/remove the marks completely/i);
    expect(prompt).toContain("No words, letters or logos.");
    expect(prompt).toBe(markupPrompt("Change only the marked area: make the circled cup blue\nx\nNo words, letters or logos."));
    const shown = await sent(calls[0].input);
    expect(shown.at(shown.width >> 1, shown.height >> 1).slice(0, 3)).toEqual([255, 0, 255]);
    // What comes back is built on the picture, not on the marked-up copy.
    const back = await pixels(out.bytes);
    let magenta = 0;
    for (let i = 0; i < back.data.length; i += 4) if (back.data[i] > 200 && back.data[i + 1] < 60 && back.data[i + 2] > 200) magenta++;
    expect(magenta).toBe(0);
    // Without marks the same call is the plain area redraw it always was.
    const plain = fakeRunpod(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#777777" } }).png().toBuffer());
    await runpodImageProvider(RUNPOD, plain.f).edit({ context: ctx, prompt: "Change only the marked area: a cup", source, mask: await regionMask(box, 512, 512, 0) }, "m");
    expect(String(plain.calls[0].input!.prompt)).toContain("Replace everything in this image with: a cup.");
  });

  it("extend: the whole canvas goes to the extend model, no close-up, and the whole answer comes back at the canvas's size", async () => {
    const canvas = await placeOnCanvas(await solid(400, 500, "#113355"), { width: 1360, height: 768 }, { left: 373, top: 0, width: 614, height: 768 }, EXTEND_MATTE);
    const answer = await sharp({ create: { width: 1024, height: 576, channels: 3, background: "#445566" } }).jpeg().toBuffer(); // its own size
    const { f, calls } = fakeRunpod(answer);
    const out = await runpodImageProvider(RUNPOD, f).edit({ context: ctx, prompt: "ignored: the provider words this", source: canvas, mask: canvas, intent: "extend" }, "qwen-image-t2i");
    expect(calls[0].url).toBe("https://api.runpod.ai/v2/qwen-image-edit-2511/runsync");
    expect(calls[0].input!.prompt).toBe(EXTEND_PROMPT);
    expect(EXTEND_PROMPT).toBe("Fill the solid green area so it continues the scene naturally. Do not change, move or resize anything that is not green. No text, letters or logos.");
    // The 2511 input shape: the picture in `images` as well.
    expect(calls[0].input!.images).toEqual([calls[0].input!.image]);
    const shown = await sent(calls[0].input);
    expect([shown.width, shown.height]).toEqual([1360, 768]);
    expect(shown.at(10, 10).slice(0, 3)).toEqual([0, 255, 0]);
    expect(shown.at(680, 384).slice(0, 3)).toEqual([0x11, 0x33, 0x55]);
    expect([out.width, out.height, out.model]).toEqual([1360, 768, "qwen-image-edit-2511"]);
    // No extend model named: the edit endpoint does it.
    const one = fakeRunpod(answer);
    await runpodImageProvider({ apiKey: "rk", timeoutMs: 5000, editModel: "qwen-image-edit" }, one.f).edit({ context: ctx, prompt: "x", source: canvas, mask: canvas, intent: "extend" }, "m");
    expect(one.calls[0].url).toBe("https://api.runpod.ai/v2/qwen-image-edit/runsync");
  });

  it("the extend model is config, with a default, and reaches the provider", () => {
    const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123" };
    expect(parseEnv(BASE).AI_IMAGE_EXTEND_MODEL).toBe("google-nano-banana-2-edit");
    expect(parseEnv({ ...BASE, AI_IMAGE_EXTEND_MODEL: "another-edit-model" }).AI_IMAGE_EXTEND_MODEL).toBe("another-edit-model");
    expect(parseEnv({ ...BASE, AI_IMAGE_EXTEND_MODEL: "" }).AI_IMAGE_EXTEND_MODEL).toBe("google-nano-banana-2-edit");
  });
});

describe("OpenAI: the same kinds of change through its real mask", () => {
  const png1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const reply = JSON.stringify({ data: [{ b64_json: Buffer.concat([png1, Buffer.alloc(200)]).toString("base64") }] });

  it("words an erase and an extension itself, and shows the marks on the picture it sends", async () => {
    const forms: FormData[] = [];
    const p = openaiImageProvider({ apiKey: "k", timeoutMs: 5000 }, async (_url, init) => {
      forms.push(init.body as FormData);
      return new Response(reply, { status: 200 });
    });
    const source = await solid(64, 64, "#113355");
    const mask = await strokeMask(BRUSH, 64, 64);
    await p.edit({ context: ctx, prompt: "the caller's words", source, mask, intent: "erase" }, "gpt-image-test");
    expect(String(forms[0].get("prompt"))).toMatch(/^Remove everything in the masked area/);
    await p.edit({ context: ctx, prompt: "the caller's words", source, mask, intent: "extend" }, "gpt-image-test");
    expect(String(forms[1].get("prompt"))).toMatch(/Fill it so the scene continues naturally/);
    const marks = await strokesOverlay([{ w: 0.1, pts: [[0.2, 0.5], [0.8, 0.5]] }], 64, 64, MARKS_COLOUR);
    await p.edit({ context: ctx, prompt: "Change only the marked area: bluer", source, mask, marks }, "gpt-image-test");
    expect(String(forms[2].get("prompt"))).toMatch(/hand-drawn marks[\s\S]*Change only the marked area: bluer/);
    const shown = await pixels(Buffer.from(await (forms[2].get("image") as Blob).arrayBuffer()));
    expect(shown.at(32, 32).slice(0, 3)).toEqual([255, 0, 255]);
    // A plain area redraw is what it always was: the caller's prompt, the picture untouched.
    await p.edit({ context: ctx, prompt: "Make the sky warmer", source, mask }, "gpt-image-test");
    expect(forms[3].get("prompt")).toBe("Make the sky warmer");
    expect(Buffer.compare(Buffer.from(await (forms[3].get("image") as Blob).arrayBuffer()), Buffer.from(source))).toBe(0);
  });
});

describe("the stand-in honours each kind of change", () => {
  it("erase: the brushed area becomes the colour around it, and nothing else changes", async () => {
    const source = await solid(120, 120, "#204060");
    const dot: Stroke[] = [{ w: 0.2, pts: [[0.5, 0.5]] }];
    // Something to erase: a red disc where the brush will go.
    const withDisc = new Uint8Array(await sharp(Buffer.from(source)).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="8" fill="#ff0000"/></svg>') }]).png().toBuffer());
    const out = await pixels((await mockImageProvider.edit({ context: ctx, prompt: "x", source: withDisc, mask: await strokeMask(dot, 120, 120), intent: "erase" }, "mock-image")).bytes);
    expect(out.at(60, 60).slice(0, 3)).toEqual([0x20, 0x40, 0x60]);
    expect(out.at(5, 5).slice(0, 3)).toEqual([0x20, 0x40, 0x60]);
  });

  it("extend: the matte is filled from the picture, with none of the matte's colour left, and the picture itself is untouched", async () => {
    const source = await patterned(100, 80);
    const size = { width: 200, height: 120 };
    const place = { left: 50, top: 20, width: 100, height: 80 };
    const canvas = await placeOnCanvas(source, size, place, EXTEND_MATTE);
    const raw = Buffer.alloc(200 * 120 * 4);
    for (let y = 20; y < 100; y++) for (let x = 50; x < 150; x++) raw[(y * 200 + x) * 4 + 3] = 255;
    const mask = new Uint8Array(await sharp(raw, { raw: { width: 200, height: 120, channels: 4 } }).png().toBuffer());
    const out = await pixels((await mockImageProvider.edit({ context: ctx, prompt: "x", source: canvas, mask, intent: "extend" }, "mock-image")).bytes);
    const before = await pixels(canvas);
    let green = 0;
    let moved = 0;
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 200; x++) {
        const [r, g, b] = out.at(x, y);
        if (g > 215 && r < 70 && b < 70) green++;
        const inside = x >= 50 && x < 150 && y >= 20 && y < 100;
        if (inside && out.at(x, y).join() !== before.at(x, y).join()) moved++;
      }
    }
    expect(green).toBe(0);
    expect(moved).toBe(0);
    // Mirrored outwards from the picture's own edge.
    expect(out.at(49, 60).slice(0, 3)).toEqual(before.at(50, 60).slice(0, 3));
    expect(await driftOf(new Uint8Array(await sharp(out.data, { raw: { width: 200, height: 120, channels: 4 } }).png().toBuffer()), source, place)).toBeLessThan(0.001);
  });

  it("markup: the marks are instructions, so none of their colour is in the result", async () => {
    const source = await solid(120, 120, "#204060");
    const marks = await strokesOverlay([{ w: 0.05, pts: [[0.2, 0.5], [0.8, 0.5]] }], 120, 120, MARKS_COLOUR);
    const out = await pixels((await mockImageProvider.edit({ context: ctx, prompt: "Change only the marked area: x", source, mask: await regionMask({ x: 0.1, y: 0.3, w: 0.8, h: 0.4 }, 120, 120, 0), marks }, "mock-image")).bytes);
    let magenta = 0;
    let changed = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i] > 200 && out.data[i + 1] < 60 && out.data[i + 2] > 200) magenta++;
      if (out.data[i] !== 0x20 || out.data[i + 1] !== 0x40 || out.data[i + 2] !== 0x60) changed++;
    }
    expect(magenta).toBe(0);
    expect(changed).toBeGreaterThan(0); // the area was still changed
  });
});

describe("Remove background", () => {
  it("refuses a picture with no clear subject: nothing found, or nearly everything kept", async () => {
    expect(CUTOUT_COVERAGE).toEqual({ min: 0.03, max: 0.9 });
    expect([0, 0.029, 0.03, 0.5, 0.9, 0.91, 1, Number.NaN].map(clearSubject)).toEqual([false, false, true, true, true, false, false, false]);

    // One flat colour: all of it is background.
    const flat = await mockCutoutProvider.cutout(await solid(80, 80, "#b0c4de"));
    expect(flat.coverage).toBe(0);
    expect(clearSubject(flat.coverage)).toBe(false);
    // Busy to the very edge: the stand-in keeps all of it, which is no subject either.
    const busy = await mockCutoutProvider.cutout(new Uint8Array(await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#000"/><rect x="2" y="2" width="76" height="76" fill="#fff"/></svg>')).png().toBuffer()));
    expect(busy.coverage).toBeGreaterThan(0.9);
    expect(clearSubject(busy.coverage)).toBe(false);

    // A subject on a plain ground: kept, the ground transparent, a PNG with alpha.
    const subject = new Uint8Array(await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#b0c4de"/><rect x="20" y="20" width="40" height="40" fill="#8b0000"/></svg>')).png().toBuffer());
    const cut = await mockCutoutProvider.cutout(subject);
    expect(cut.coverage).toBeCloseTo(0.25, 1);
    expect(clearSubject(cut.coverage)).toBe(true);
    const meta = await sharp(Buffer.from(cut.bytes)).metadata();
    expect([meta.format, meta.hasAlpha]).toEqual(["png", true]);
    const px = await pixels(cut.bytes);
    expect(px.at(40, 40)).toEqual([0x8b, 0, 0, 255]);
    expect(px.at(5, 5)[3]).toBe(0);
    // The same picture gives the same cut-out.
    expect(Buffer.compare(Buffer.from((await mockCutoutProvider.cutout(subject)).bytes), Buffer.from(cut.bytes))).toBe(0);
  });

  it("says whether the tool can run here, and why not, in words for the board", () => {
    const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123" };
    const off = parseEnv(BASE);
    expect(off.AI_CUTOUT_PROVIDER).toBe("off");
    expect(cutoutStatus(off)).toEqual({ available: false, reason: CUTOUT_OFF });
    expect(CUTOUT_OFF).toBe("Background removal isn't switched on for this workspace yet.");
    expect(() => selectCutoutProvider(off)).toThrow(AiConfigError);

    expect(cutoutStatus(parseEnv({ ...BASE, AI_CUTOUT_PROVIDER: "mock" }))).toEqual({ available: true, reason: null });
    expect(selectCutoutProvider(parseEnv({ ...BASE, AI_CUTOUT_PROVIDER: "mock" })).name).toBe("mock");

    const missing = parseEnv({ ...BASE, AI_CUTOUT_PROVIDER: "onnx", AI_CUTOUT_MODEL_PATH: "./models/not-there.onnx" });
    expect(cutoutStatus(missing)).toEqual({ available: false, reason: CUTOUT_NO_MODEL });
    expect(CUTOUT_NO_MODEL).toBe("The background model file is missing. Your admin can add it.");
    expect(() => selectCutoutProvider(missing)).toThrow(/models:fetch/);
    // Neither reason says "AI".
    for (const r of [CUTOUT_OFF, CUTOUT_NO_MODEL]) expect(r).not.toMatch(/\bAI\b/);
    // The stand-in is for development: production refuses it, like the other stand-ins.
    const PROD = { ...BASE, NODE_ENV: "production", AUTH_DRIVER: "email", AUTH_SECRET: "a".repeat(64), MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x", MAIL_FROM: "a@b.co", AI_TEXT_PROVIDER: "groq", GROQ_API_KEY: "g", AI_TEXT_MODEL_STRONG: "s", AI_TEXT_MODEL_CHEAP: "c", AI_IMAGE_PROVIDER: "openai", OPENAI_API_KEY: "k", AI_IMAGE_MODEL: "m" };
    expect(() => parseEnv({ ...PROD, AI_CUTOUT_PROVIDER: "mock" })).toThrow(/AI_CUTOUT_PROVIDER=mock/);
    expect(parseEnv({ ...PROD, AI_CUTOUT_PROVIDER: "onnx" }).AI_CUTOUT_PROVIDER).toBe("onnx");
  });

  it("prepares the picture the way the model's reference does, and turns its matte into alpha", async () => {
    // In: channel-first, each value divided by the picture's brightest, minus 0.5.
    const input = await cutoutInput(await solid(40, 30, "#804000"));
    const plane = 1024 * 1024;
    expect(input).toHaveLength(3 * plane);
    expect(input[0]).toBeCloseTo(0.5, 5); // red 128 is the brightest value: 128/128 - 0.5
    expect(input[plane]).toBeCloseTo(0x40 / 0x80 - 0.5, 5);
    expect(input[2 * plane]).toBeCloseTo(-0.5, 5);

    // Out: the matte stretched to its own range, resized to the picture, used as alpha.
    const matte = new Float32Array(plane);
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 512; x++) matte[y * 1024 + x] = 7; // the left half is the subject, on any scale
    for (let i = 0; i < plane; i++) if (matte[i] === 0) matte[i] = 3;
    const { bytes, coverage } = await applyMatte(await solid(40, 30, "#804000"), matte);
    expect(coverage).toBeCloseTo(0.5, 1);
    const px = await pixels(bytes);
    expect([px.width, px.height]).toEqual([40, 30]);
    expect(px.at(5, 15)).toEqual([0x80, 0x40, 0, 255]);
    expect(px.at(35, 15)[3]).toBe(0);
    // A flat matte has no subject, and is not a divide by zero.
    expect((await applyMatte(await solid(40, 30, "#804000"), new Float32Array(plane).fill(0.4))).coverage).toBe(0);
  });

  it("a design keeps the cut-out flag on its picture, and only when it is set", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(parseDesign({ pictures: { post: { id, mode: "live_text", cutout: true } } }).pictures.post).toEqual({ id, mode: "live_text", cutout: true });
    expect(parseDesign({ pictures: { post: { id, mode: "live_text", cutout: "yes" } } }).pictures.post).toEqual({ id, mode: "live_text" });
    expect(parseDesign({ pictures: { post: { id, mode: "with_text" } } }).pictures.post).toEqual({ id, mode: "with_text" });
  });
});

// 2026-11-18 live run: a cut-out keeps only its subject, so it is not small on the visual.
import { trimToSubject } from "@/lib/data/pictures";
import sharpTrim from "sharp";
describe("trimToSubject", () => {
  it("crops a cut-out to its solid pixels with a little room, and leaves an empty one alone", async () => {
    const w = 200, h = 300;
    const raw = Buffer.alloc(w * h * 4);
    for (let y = 100; y < 160; y++) for (let x = 60; x < 140; x++) { const i = (y * w + x) * 4; raw[i] = 200; raw[i + 3] = 255; }
    const png = new Uint8Array(await sharpTrim(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
    const meta = await sharpTrim(Buffer.from(await trimToSubject(png))).metadata();
    // 80 x 60 subject, padded by 4% of 80 (3 px) on each side.
    expect(meta.width).toBe(86);
    expect(meta.height).toBe(66);
    const empty = new Uint8Array(await sharpTrim(Buffer.alloc(w * h * 4), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
    expect(await trimToSubject(empty)).toBe(empty);
  });
});

// 2026-11-18 live run: Erase came back with the magenta paint still in it.
import { marksLeft } from "@/lib/visual/region";
describe("marksLeft", () => {
  it("measures magenta added inside the box, not magenta that was already there", async () => {
    const make = async (paint: (x: number, y: number) => [number, number, number]) => {
      const w = 100, h = 100, raw = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(paint(x, y), (y * w + x) * 3);
      return new Uint8Array(await sharpTrim(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer());
    };
    const grey = await make(() => [120, 120, 120]);
    const painted = await make((x, y) => (x >= 40 && x < 60 && y >= 40 && y < 60 ? [255, 0, 255] : [120, 120, 120]));
    const box = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
    expect(await marksLeft(grey, painted, box)).toBeCloseTo(400 / 1600, 2);
    expect(await marksLeft(painted, painted, box)).toBe(0);
    expect(await marksLeft(grey, grey, box)).toBe(0);
  });
});

describe("growBox (one-click pins)", () => {
  it("grows around the box's own centre", async () => {
    const { growBox } = await import("@/lib/visual/region");
    const g = growBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, 2);
    expect(g.w).toBeCloseTo(0.4);
    expect(g.h).toBeCloseTo(0.2);
    expect(g.x + g.w / 2).toBeCloseTo(0.5);
    expect(g.y + g.h / 2).toBeCloseTo(0.45);
  });
  it("stays inside the picture and never exceeds it", async () => {
    const { growBox } = await import("@/lib/visual/region");
    const corner = growBox({ x: 0.8, y: 0, w: 0.2, h: 0.2 }, 1.7);
    expect(corner.x + corner.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(corner.y).toBeGreaterThanOrEqual(0);
    expect(corner.w).toBeCloseTo(0.34);
    const whole = growBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 1.7);
    expect(whole).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("objectBoxAt (one-click pins are sized to the thing clicked)", () => {
  const picture = async () => {
    const sharp = (await import("sharp")).default;
    // A cream ground with one wide blue block (two shades, like a lit solid) and a small red dot.
    const block = await sharp({ create: { width: 700, height: 150, channels: 3, background: "#2f5fd0" } }).png().toBuffer();
    const side = await sharp({ create: { width: 700, height: 120, channels: 3, background: "#27489c" } }).png().toBuffer();
    const dot = await sharp({ create: { width: 30, height: 30, channels: 3, background: "#d02f2f" } }).png().toBuffer();
    return new Uint8Array(await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#f3ead8" } })
      .composite([{ input: block, left: 150, top: 400 }, { input: side, left: 150, top: 550 }, { input: dot, left: 60, top: 60 }])
      .png().toBuffer());
  };
  it("finds the clicked face of the block, far wider than a click box", async () => {
    const { objectBoxAt } = await import("@/lib/visual/region");
    const box = await objectBoxAt(await picture(), { x: 0.5, y: 0.47 });
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThan(0.15);
    expect(box!.x + box!.w).toBeGreaterThan(0.85);
    expect(box!.y).toBeLessThan(0.4);
    expect(box!.y + box!.h).toBeGreaterThan(0.55);
    expect(box!.w).toBeLessThanOrEqual(1);
  });
  it("gives nothing for the ground behind everything", async () => {
    const { objectBoxAt } = await import("@/lib/visual/region");
    expect(await objectBoxAt(await picture(), { x: 0.5, y: 0.1 })).toBeNull();
  });
  it("gives nothing for a speck", async () => {
    const { objectBoxAt } = await import("@/lib/visual/region");
    expect(await objectBoxAt(await picture(), { x: 0.075, y: 0.075 })).toBeNull();
  });
  it("unionBox holds both boxes", async () => {
    const { unionBox } = await import("@/lib/visual/region");
    expect(unionBox({ x: 0.35, y: 0.35, w: 0.3, h: 0.24 }, { x: 0.1, y: 0.4, w: 0.8, h: 0.3 })).toEqual({ x: 0.1, y: 0.35, w: 0.8, h: expect.closeTo(0.35, 5) });
  });
});

describe("pieceTaskLines (a utility format follows its topic)", () => {
  it("keeps the angle and the pillar for a post", async () => {
    const { pieceTaskLines } = await import("@/lib/content/formats");
    const lines = pieceTaskLines("linkedin_post", "Why the sentence comes first", "Sentence First", "The mistake most people make");
    expect(lines).toContain("Pillar: Sentence First");
    expect(lines.some((l) => l.startsWith("Angle: The mistake most people make"))).toBe(true);
  });
  it("drops the angle and makes the pillar background for a bio, a reply or a message", async () => {
    const { pieceTaskLines, formatIsUtility } = await import("@/lib/content/formats");
    for (const key of ["bio", "whatsapp_message", "slack_message", "linkedin_comment"]) {
      expect(formatIsUtility(key)).toBe(true);
      const lines = pieceTaskLines(key, "Short bio for a conference programme", "Sentence First", "The mistake most people make");
      expect(lines.some((l) => l.startsWith("Angle:"))).toBe(false);
      expect(lines.some((l) => l.includes("not a post"))).toBe(true);
      expect(lines.some((l) => l.startsWith("Pillar (background only"))).toBe(true);
      expect(lines).toContain("Topic: Short bio for a conference programme");
    }
    for (const key of ["linkedin_post", "ig_carousel", "hook_set", "newsletter_section", "x_post"]) expect(formatIsUtility(key)).toBe(false);
  });
});

describe("pieceTaskLines: a bio", () => {
  it("says what a bio is and rules out a post's opening and close", async () => {
    const { pieceTaskLines } = await import("@/lib/content/formats");
    const lines = pieceTaskLines("bio", "Short bio for a conference programme", "Sentence First", null).join("\n");
    expect(lines).toMatch(/Third person when it is for a programme/);
    expect(lines).toMatch(/no slogan/);
    expect(pieceTaskLines("whatsapp_message", "Notes are ready", null, null).join("\n")).not.toMatch(/Third person/);
  });
});

describe("erase: the shadow lifted with an object, and a thin line the model kept", () => {
  const W = 400, H = 400;
  const png = async (paint: (x: number, y: number) => [number, number, number]) => {
    const sharp = (await import("sharp")).default;
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = paint(x, y); const i = (y * W + x) * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; }
    return new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
  };
  const maskOf = async (inBrush: (x: number, y: number) => boolean) => {
    const sharp = (await import("sharp")).default;
    const raw = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw[(y * W + x) * 4 + 3] = inBrush(x, y) ? 0 : 255;
    return new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
  };
  const at = async (img: Uint8Array, x: number, y: number) => {
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (y * W + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const floor: [number, number, number] = [230, 222, 205];
  const shade: [number, number, number] = [150, 144, 132];
  // A block at 150-250 with its shadow falling left to x 90, past a brush that covers only the block.
  const inBlock = (x: number, y: number) => x >= 150 && x < 250 && y >= 150 && y < 250;
  const inShadow = (x: number, y: number) => x >= 90 && x < 150 && y >= 170 && y < 250;

  it("takes the shadow the model lifted, and nothing else outside the brush", async () => {
    const { keepInsideMask, shadowGrownMask } = await import("@/lib/visual/region");
    const original = await png((x, y) => (inBlock(x, y) ? [40, 60, 140] : inShadow(x, y) ? shade : floor));
    // The model's answer: block and shadow gone, and one unrelated change far away (must stay the original's).
    const answer = await png((x, y) => (x > 350 && y > 350 ? [0, 0, 0] : floor));
    const mask = await maskOf((x, y) => x >= 145 && x < 255 && y >= 145 && y < 255);
    const grown = await shadowGrownMask(original, answer, mask);
    expect(grown).not.toBeNull();
    const merged = await keepInsideMask(original, answer, grown!, 6);
    const shadowNow = await at(merged, 110, 210);
    expect(shadowNow[0]).toBeGreaterThan(215);
    expect(await at(merged, 380, 380)).toEqual(floor);
    expect(await at(merged, 30, 30)).toEqual(floor);
  });

  it("does not grow when the model changed the light of the whole scene", async () => {
    const { shadowGrownMask } = await import("@/lib/visual/region");
    const original = await png(() => [120, 120, 120]);
    const answer = await png(() => [200, 200, 200]);
    const mask = await maskOf((x, y) => x >= 180 && x < 220 && y >= 180 && y < 220);
    expect(await shadowGrownMask(original, answer, mask)).toBeNull();
  });

  it("tells a kept line from an erased one", async () => {
    const { keptInside } = await import("@/lib/visual/region");
    const wallFloor = (x: number, y: number): [number, number, number] => (y < 196 ? [200, 190, 180] : y < 204 ? [20, 20, 20] : floor);
    const original = await png((x, y) => wallFloor(x, y));
    const mask = await maskOf((x, y) => y >= 190 && y < 210);
    expect(await keptInside(original, original, mask)).toBeGreaterThan(0.95);
    const erased = await png((x, y) => (y < 200 ? [200, 190, 180] : floor));
    expect(await keptInside(original, erased, mask)).toBeLessThan(0.85);
  });

  it("fills a thin line from its two sides, touching nothing else", async () => {
    const { fillThin } = await import("@/lib/visual/region");
    const original = await png((x, y) => (y < 196 ? [200, 190, 180] : y < 204 ? [20, 20, 20] : floor));
    const mask = await maskOf((x, y) => y >= 192 && y < 208);
    const filled = await fillThin(original, mask);
    const mid = await at(filled, 200, 200);
    expect(mid[0]).toBeGreaterThan(150);
    expect(await at(filled, 200, 100)).toEqual([200, 190, 180]);
    expect(await at(filled, 200, 300)).toEqual(floor);
  });
});
