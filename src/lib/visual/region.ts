/**
 * The geometry of "change only this part of the picture".
 *
 * A comment marks a box on the visual as fractions of its width and height
 * (0..1), so it survives any display size. For a picture edit:
 *
 *   regionMask   the mask the model gets: the picture's exact size, transparent
 *                inside the box (padded a little so the redraw can blend),
 *                opaque elsewhere.
 *   keepOutside  the guarantee: the model's result is used only inside the
 *                box, with a soft edge, and the original everywhere else. A
 *                model that treats the mask as a hint (they do) can't move a
 *                pixel outside the marked area.
 *
 * The picture tools (2026-11-18) add the same two halves for a freehand area
 * and for a bigger frame:
 *
 *   cleanStrokes / strokesBox / strokeMask / strokesOverlay
 *                    what was drawn on the picture: capped, boxed, as the
 *                    mask of a brushed area, and as visible marks for the model.
 *   keepInsideMask   Erase's guarantee: the model's result is used only where
 *                    the brush went; every other pixel is the original, byte
 *                    for byte.
 *   placeOnCanvas / keepOriginal / driftOf
 *                    Resize: the picture set in a bigger frame on a flat matte,
 *                    and afterwards the original pasted back over its place so
 *                    only the new area is the model's.
 *
 * Server-side (sharp); also used by the picture smoke test outside Next.
 */
import sharp from "sharp";
import type { Box } from "./region-types";
import { MAX_STROKES, MAX_STROKE_POINTS, PEN_WIDTH, STROKE_WIDTH, type Stroke } from "./picture-tools";

export type { Box };

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** A box inside the picture, at least a sliver wide and tall. Null when it isn't one. */
export function cleanBox(b: Partial<Box> | null | undefined): Box | null {
  if (!b) return null;
  const x = clamp01(Number(b.x));
  const y = clamp01(Number(b.y));
  const w = Math.min(1 - x, clamp01(Number(b.w)));
  const h = Math.min(1 - y, clamp01(Number(b.h)));
  if (w < 0.01 || h < 0.01) return null;
  return { x, y, w, h };
}

/** The box in pixels, grown by `pad` of the picture's shorter side and kept inside it. */
export function boxPixels(box: Box, width: number, height: number, pad = 0): { left: number; top: number; width: number; height: number } {
  const p = Math.round(Math.min(width, height) * pad);
  const left = Math.max(0, Math.floor(box.x * width) - p);
  const top = Math.max(0, Math.floor(box.y * height) - p);
  const right = Math.min(width, Math.ceil((box.x + box.w) * width) + p);
  const bottom = Math.min(height, Math.ceil((box.y + box.h) * height) + p);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** PNG mask at the picture's size: transparent (editable) inside the padded box, opaque black elsewhere. */
export async function regionMask(box: Box, width: number, height: number, pad = 0.02): Promise<Uint8Array> {
  const r = boxPixels(box, width, height, pad);
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) raw[i * 4 + 3] = 255;
  for (let y = r.top; y < r.top + r.height; y++) {
    for (let x = r.left; x < r.left + r.width; x++) raw[(y * width + x) * 4 + 3] = 0;
  }
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer());
}

/**
 * PNG mask at the picture's size, transparent (editable) inside any of the
 * boxes and opaque elsewhere: the area an Erase of found words may change
 * (lib/visual/picture-words). `except` is a part that must never change
 * (a resized picture's original place), opaque even where a box covers it.
 */
export async function boxesMask(boxes: Box[], width: number, height: number, except?: PixelRect | null): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) raw[i * 4 + 3] = 255;
  for (const b of boxes) {
    const r = boxPixels(b, width, height, 0);
    for (let y = r.top; y < r.top + r.height; y++) {
      for (let x = r.left; x < r.left + r.width; x++) {
        if (except && x >= except.left && x < except.left + except.width && y >= except.top && y < except.top + except.height) continue;
        raw[(y * width + x) * 4 + 3] = 0;
      }
    }
  }
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer());
}

/** Whether a mask (as boxesMask makes) leaves anything editable. */
export async function maskHasArea(mask: Uint8Array): Promise<boolean> {
  const { data, info } = await sharp(Buffer.from(mask)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] < 128) return true;
  return false;
}

/** The blend at a comment area's edge, as a share of the area's shorter side, and its bounds in px. */
export const SEAM_SHARE = 0.05;
export const SEAM_MIN = 12;
export const SEAM_MAX = 72;

/**
 * How wide the blend at a box's edge is, in px: SEAM_SHARE of its shorter
 * side, kept between SEAM_MIN and SEAM_MAX. A fixed 12 px left a visible step
 * where a thin thing (a chain) crossed the edge of a big area (2026-11-18).
 */
export function seamFeather(widthPx: number, heightPx: number): number {
  return Math.max(SEAM_MIN, Math.min(SEAM_MAX, Math.round(SEAM_SHARE * Math.min(widthPx, heightPx))));
}

/**
 * The edited picture inside the box (soft edge of `feather` px, by default
 * scaled to the box: seamFeather), the original everywhere else. Both are
 * brought to the original's size first, so a model that returns a different
 * size can't shift anything. Every pixel outside the box is the original's.
 */
export async function keepOutside(original: Uint8Array, edited: Uint8Array, box: Box, feather?: number): Promise<Uint8Array> {
  const base = sharp(Buffer.from(original)).ensureAlpha();
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("The original picture couldn't be read.");
  const orig = await base.raw().toBuffer();
  const next = await sharp(Buffer.from(edited)).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const r = boxPixels(box, width, height, 0);
  const soft = feather ?? seamFeather(r.width, r.height);
  const out = Buffer.from(orig);
  for (let y = r.top; y < r.top + r.height; y++) {
    for (let x = r.left; x < r.left + r.width; x++) {
      // Distance to the box edge sets how much of the edit shows: full inside,
      // fading at the rim on an S-curve (no visible line where the fade starts).
      const d = Math.min(x - r.left, r.left + r.width - 1 - x, y - r.top, r.top + r.height - 1 - y);
      const t = soft > 0 ? Math.min(1, (d + 1) / soft) : 1;
      const a = t * t * (3 - 2 * t);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[i + c] = Math.round(orig[i + c] * (1 - a) + next[i + c] * a);
    }
  }
  return new Uint8Array(await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer());
}

/** A pixel the model changed by more than this (mean of R, G and B, 0-255) counts as a real change, not re-drawing noise. */
export const EDGE_CHANGE = 40;
/**
 * More than this share of one side's border band changed, and the change runs
 * across the area's edge (cutAtEdge). Measured on the saved answers of
 * 2026-11-18/19: the plant sliced flat along the bottom 0.26; a weight and a
 * bell kept inside their areas 0.00 to 0.05.
 */
export const EDGE_CUT_LIMIT = 0.15;

/**
 * How much of the model's change is cut off at the edge of the area (PI-18,
 * PI-19). keepOutside keeps the answer only inside the box, fading it out
 * over the feather at the rim, so whatever the model drew across the box's
 * border is sliced off there: a plant drawn with its pot below the box came
 * out as a sprout cut flat along the box's bottom (2026-11-19), and a scene
 * re-drawn a little off its place leaves a join. For each side of the box
 * that is not the picture's own edge: the share of a band straddling the
 * border (half the feather inside, as much outside) where the answer differs
 * from the original by more than EDGE_CHANGE. The worst side is returned:
 * 0, the change sits inside the area; near 1, it runs across that whole side.
 */
export async function cutAtEdge(original: Uint8Array, answer: Uint8Array, box: Box, feather?: number): Promise<number> {
  const base = sharp(Buffer.from(original)).removeAlpha();
  const { width, height } = await base.metadata();
  if (!width || !height) return 0;
  const a = await base.raw().toBuffer();
  const b = await sharp(Buffer.from(answer)).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const r = boxPixels(box, width, height, 0);
  const band = Math.max(4, Math.round((feather ?? seamFeather(r.width, r.height)) / 2));
  const x0 = r.left, y0 = r.top, x1 = r.left + r.width - 1, y1 = r.top + r.height - 1;
  const changed = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    return (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3 > EDGE_CHANGE;
  };
  /** The share changed in the band across one side: `along` runs the side's length, `at(k, j)` is the pixel k from the border (negative inside). */
  const side = (from: number, to: number, at: (k: number, j: number) => [number, number]) => {
    let seen = 0, cut = 0;
    for (let k = -band; k <= band; k++) {
      for (let j = from; j <= to; j++) {
        const [x, y] = at(k, j);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        seen++;
        if (changed(x, y)) cut++;
      }
    }
    return seen ? cut / seen : 0;
  };
  let worst = 0;
  if (x0 > 0) worst = Math.max(worst, side(y0, y1, (k, j) => [x0 - k, j]));
  if (x1 < width - 1) worst = Math.max(worst, side(y0, y1, (k, j) => [x1 + k, j]));
  if (y0 > 0) worst = Math.max(worst, side(x0, x1, (k, j) => [j, y0 - k]));
  if (y1 < height - 1) worst = Math.max(worst, side(x0, x1, (k, j) => [j, y1 + k]));
  return worst;
}

// ---- freehand strokes (Markup, Erase) -----------------------------------------------

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** At most `max` points of a line, evenly taken, keeping its two ends. */
function thin<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  return Array.from({ length: max }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (max - 1))]);
}

/**
 * What was drawn, as it may be kept and used: at most MAX_STROKES strokes of
 * MAX_STROKE_POINTS points each (a longer line is thinned, never cut short),
 * every point inside the picture, every width inside STROKE_WIDTH. Anything
 * that isn't a stroke is dropped; nothing usable gives an empty list.
 */
export function cleanStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  const out: Stroke[] = [];
  for (const s of raw as { w?: unknown; pts?: unknown }[]) {
    if (out.length >= MAX_STROKES) break;
    if (!s || typeof s !== "object" || !Array.isArray(s.pts)) continue;
    const pts: [number, number][] = [];
    for (const p of s.pts as unknown[]) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([round4(clamp01(x)), round4(clamp01(y))]);
    }
    if (pts.length === 0) continue;
    const w = Number(s.w);
    out.push({
      w: round4(Number.isFinite(w) ? Math.min(STROKE_WIDTH.max, Math.max(STROKE_WIDTH.min, w)) : PEN_WIDTH),
      pts: thin(pts, MAX_STROKE_POINTS),
    });
  }
  return out;
}

/**
 * The box around the strokes, their own width included, grown by `pad` (a
 * share of the picture's shorter side) and kept inside the picture. `aspect`
 * is the picture's width over its height: stroke widths and the pad are
 * measured on the shorter side, the box in fractions of each side. Null when
 * there are no strokes.
 */
export function strokesBox(strokes: Stroke[], pad = 0, aspect = 1): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  // The shorter side, as a share of the width and of the height.
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const fx = a >= 1 ? 1 / a : 1;
  const fy = a >= 1 ? 1 : a;
  for (const s of strokes) {
    const grow = s.w / 2 + Math.max(0, pad);
    for (const [x, y] of s.pts) {
      x0 = Math.min(x0, x - grow * fx);
      x1 = Math.max(x1, x + grow * fx);
      y0 = Math.min(y0, y - grow * fy);
      y1 = Math.max(y1, y + grow * fy);
    }
  }
  if (!Number.isFinite(x0)) return null;
  // A dot is still a place: never thinner than a sliver the redraw can use.
  const MIN = 0.02;
  if (x1 - x0 < MIN) { const c = (x0 + x1) / 2; x0 = c - MIN / 2; x1 = c + MIN / 2; }
  if (y1 - y0 < MIN) { const c = (y0 + y1) / 2; y0 = c - MIN / 2; y1 = c + MIN / 2; }
  x0 = Math.max(0, Math.min(1 - MIN, x0));
  y0 = Math.max(0, Math.min(1 - MIN, y0));
  return cleanBox({ x: x0, y: y0, w: Math.min(1, x1) - x0, h: Math.min(1, y1) - y0 });
}

/** Which pixels the strokes cover (1) at this size: round-ended lines of each stroke's own width. */
function brushed(strokes: Stroke[], width: number, height: number): Uint8Array {
  const on = new Uint8Array(width * height);
  const side = Math.min(width, height);
  for (const s of strokes) {
    const r = Math.max(0.75, (s.w * side) / 2);
    const pts = s.pts.map(([x, y]) => [x * width, y * height] as const);
    for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[Math.min(i + 1, pts.length - 1)];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const left = Math.max(0, Math.floor(Math.min(ax, bx) - r));
      const right = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + r));
      const top = Math.max(0, Math.floor(Math.min(ay, by) - r));
      const bottom = Math.min(height - 1, Math.ceil(Math.max(ay, by) + r));
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          // Distance from the pixel's centre to the segment.
          const px = x + 0.5 - ax;
          const py = y + 0.5 - ay;
          const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
          const ex = px - t * dx;
          const ey = py - t * dy;
          if (ex * ex + ey * ey <= r * r) on[y * width + x] = 1;
        }
      }
    }
  }
  return on;
}

/**
 * PNG mask of a brushed area at the picture's size, in regionMask's
 * convention: transparent (may change) where the brush went, opaque black
 * elsewhere. Hard-edged, so "brushed or not" has one answer per pixel.
 */
export async function strokeMask(strokes: Stroke[], width: number, height: number): Promise<Uint8Array> {
  const on = brushed(strokes, width, height);
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) raw[i * 4 + 3] = on[i] ? 0 : 255;
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer());
}

const HEX6 = /^#[0-9a-f]{6}$/i;

/**
 * The strokes drawn in one colour on a transparent PNG at the picture's size:
 * the marks the model is shown (Markup), composited over the picture by the
 * provider. They are never kept in the result.
 */
export async function strokesOverlay(strokes: Stroke[], width: number, height: number, colour: string): Promise<Uint8Array> {
  const side = Math.min(width, height);
  const ink = HEX6.test(colour) ? colour : "#ff00ff";
  const n = (v: number) => v.toFixed(1);
  const shapes = strokes.map((s) => {
    const w = Math.max(2, s.w * side);
    if (s.pts.length === 1) return `<circle cx="${n(s.pts[0][0] * width)}" cy="${n(s.pts[0][1] * height)}" r="${n(w / 2)}" fill="${ink}"/>`;
    const d = s.pts.map(([x, y]) => `${n(x * width)},${n(y * height)}`).join(" ");
    return `<polyline points="${d}" fill="none" stroke="${ink}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).resize(width, height, { fit: "fill" }).ensureAlpha().png().toBuffer());
}

/**
 * Erase's guarantee. The edited picture is used only where `mask` is
 * transparent (brushed); every pixel where the mask is opaque is the
 * original's, byte for byte, whatever the model returned and at whatever
 * size. Inside the brushed area the edit fades in over about `feather` px
 * from the rim, so the fill joins what is around it: each pixel's weight is
 * the smaller of the hard mask (0 outside, so nothing outside can move) and
 * the blurred mask, read as 0 at the rim and 1 well inside.
 */
export async function keepInsideMask(original: Uint8Array, edited: Uint8Array, mask: Uint8Array, feather = 12): Promise<Uint8Array> {
  const base = sharp(Buffer.from(original)).ensureAlpha();
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("The original picture couldn't be read.");
  const orig = await base.raw().toBuffer();
  const next = await sharp(Buffer.from(edited)).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const m = await sharp(Buffer.from(mask)).resize(width, height, { fit: "fill", kernel: "nearest" }).ensureAlpha().raw().toBuffer();
  const hard = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) hard[i] = m[i * 4 + 3] < 128 ? 255 : 0;
  const soft = feather > 0
    // extractChannel: sharp hands a one-channel picture back as three unless told which one is wanted.
    ? await sharp(hard, { raw: { width, height, channels: 1 } }).blur(Math.max(0.3, feather / 2)).extractChannel(0).raw().toBuffer()
    : hard;
  const out = Buffer.from(orig);
  for (let i = 0; i < width * height; i++) {
    if (!hard[i]) continue; // not brushed: the original, untouched
    // The blurred mask is about half at a straight rim: stretched so the edit starts from nothing there.
    const a = feather > 0 ? Math.min(1, Math.max(0, (soft[i] / 255 - 0.5) * 2)) : 1;
    if (a <= 0) continue;
    const p = i * 4;
    for (let c = 0; c < 4; c++) out[p + c] = Math.round(orig[p + c] * (1 - a) + next[p + c] * a);
  }
  return new Uint8Array(await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer());
}

/**
 * How much the brushed area changed between two pictures of the same size:
 * the mean colour difference over the pixels where `mask` is transparent,
 * from 0 (the same) to 1. An erase that comes back near 0 removed nothing.
 */
export async function changeInside(before: Uint8Array, after: Uint8Array, mask: Uint8Array): Promise<number> {
  const a = sharp(Buffer.from(before)).removeAlpha();
  const { width, height } = await a.metadata();
  if (!width || !height) return 0;
  const A = await a.raw().toBuffer();
  const B = await sharp(Buffer.from(after)).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const m = await sharp(Buffer.from(mask)).resize(width, height, { fit: "fill", kernel: "nearest" }).ensureAlpha().raw().toBuffer();
  let n = 0;
  let sum = 0;
  for (let i = 0; i < width * height; i++) {
    if (m[i * 4 + 3] >= 128) continue;
    n++;
    const p = i * 3;
    sum += (Math.abs(A[p] - B[p]) + Math.abs(A[p + 1] - B[p + 1]) + Math.abs(A[p + 2] - B[p + 2])) / 765;
  }
  return n ? sum / n : 0;
}

// ---- a bigger frame (Resize) -----------------------------------------------------------

export interface PixelRect { left: number; top: number; width: number; height: number }

/** The part of a placed rectangle that is inside a canvas. Null when none of it is. */
export function visiblePart(place: PixelRect, size: { width: number; height: number }): PixelRect | null {
  const left = Math.max(0, place.left);
  const top = Math.max(0, place.top);
  const right = Math.min(size.width, place.left + place.width);
  const bottom = Math.min(size.height, place.top + place.height);
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** The picture at its placed size, cut to what shows inside the canvas (raw RGB). */
async function placed(source: Uint8Array, size: { width: number; height: number }, place: PixelRect): Promise<{ data: Buffer; part: PixelRect } | null> {
  const part = visiblePart(place, size);
  if (!part) return null;
  // Two steps, so the cut is always taken from the picture at its placed size.
  const sized = await sharp(Buffer.from(source)).removeAlpha().resize(Math.max(1, place.width), Math.max(1, place.height), { fit: "fill" }).raw().toBuffer();
  const data = await sharp(sized, { raw: { width: Math.max(1, place.width), height: Math.max(1, place.height), channels: 3 } })
    .extract({ left: part.left - place.left, top: part.top - place.top, width: part.width, height: part.height })
    .raw()
    .toBuffer();
  return { data, part };
}

/**
 * The picture set in a new frame: a canvas of `size`, filled with one flat
 * colour (`matte`, #rrggbb), the picture drawn at `placePx` (it may start
 * before the canvas or run past it; those parts are cut away). PNG, opaque.
 */
export async function placeOnCanvas(source: Uint8Array, size: { width: number; height: number }, placePx: PixelRect, matte: string): Promise<Uint8Array> {
  const canvas = sharp({ create: { width: size.width, height: size.height, channels: 3, background: HEX6.test(matte) ? matte : "#00ff00" } });
  const p = await placed(source, size, placePx);
  const out = p
    ? canvas.composite([{ input: p.data, raw: { width: p.part.width, height: p.part.height, channels: 3 }, left: p.part.left, top: p.part.top }])
    : canvas;
  return new Uint8Array(await out.png().toBuffer());
}

/**
 * Resize's guarantee. `extended` is the model's answer at the canvas's size;
 * the original picture is pasted back over its place, opaque, so the model's
 * version of what was already there is thrown away. Only along the sides of
 * the original that border new area does it fade in over `feather` px (from
 * the model's pixels at the edge to the original's inside), so the join does
 * not show; a side that sits on the canvas's own edge is not faded.
 */
export async function keepOriginal(extended: Uint8Array, source: Uint8Array, placePx: PixelRect, feather = 16): Promise<Uint8Array> {
  const base = sharp(Buffer.from(extended)).removeAlpha();
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("The extended picture couldn't be read.");
  const out = await base.raw().toBuffer();
  const p = await placed(source, { width, height }, placePx);
  if (p) {
    const { part, data } = p;
    const right = part.left + part.width;
    const bottom = part.top + part.height;
    // A side borders new area when the canvas goes on past it.
    const fade = { left: part.left > 0, right: right < width, top: part.top > 0, bottom: bottom < height };
    for (let y = part.top; y < bottom; y++) {
      for (let x = part.left; x < right; x++) {
        let a = 1;
        if (feather > 0) {
          if (fade.left) a = Math.min(a, (x - part.left + 1) / feather);
          if (fade.right) a = Math.min(a, (right - x) / feather);
          if (fade.top) a = Math.min(a, (y - part.top + 1) / feather);
          if (fade.bottom) a = Math.min(a, (bottom - y) / feather);
        }
        const o = (y * width + x) * 3;
        const s = ((y - part.top) * part.width + (x - part.left)) * 3;
        if (a >= 1) {
          out[o] = data[s];
          out[o + 1] = data[s + 1];
          out[o + 2] = data[s + 2];
        } else {
          for (let c = 0; c < 3; c++) out[o + c] = Math.round(out[o + c] * (1 - a) + data[s + c] * a);
        }
      }
    }
  }
  return new Uint8Array(await sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

/** How many lines either side of a join seamOf looks at. */
const SEAM_REACH = 6;

/**
 * How sharp the join is between the original and the drawn area after
 * keepOriginal: along each side of the original that borders new area, the
 * colour step across the join (2 x SEAM_REACH + 1 lines, lightly blurred) less what the
 * picture changes over as many lines nearby, as a share of full contrast. 0
 * is a join that does not show. A model that draws the new area without
 * matching the edge (live 2026-11-18: a wall a shade darker, a table edge at
 * another height) leaves a straight line here, about 0.15-0.3; a picture's
 * own texture measures near 0.
 */
export async function seamOf(png: Uint8Array, placePx: PixelRect): Promise<number> {
  const { data, info } = await sharp(Buffer.from(png)).removeAlpha().blur(1).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const part = visiblePart(placePx, { width: W, height: H });
  if (!part) return 0;
  const px = (x: number, y: number, c: number) => data[(y * W + x) * 3 + c];
  /** The mean step between line i-1 and line i, across the side's length (vertical lines when `cols`). */
  const step = (cols: boolean, i: number, from: number, to: number) => {
    let s = 0;
    for (let j = from; j < to; j++) {
      for (let c = 0; c < 3; c++) s += cols ? Math.abs(px(i, j, c) - px(i - 1, j, c)) : Math.abs(px(j, i, c) - px(j, i - 1, c));
    }
    return s / Math.max(1, to - from) / 765;
  };
  const side = (cols: boolean, edge: number, from: number, to: number, limit: number) => {
    const at = (i: number) => (i >= 1 && i < limit ? step(cols, i, from, to) : 0);
    // A few lines either side: the model's own copy of the original can sit a pixel or few off its place.
    let across = 0;
    for (let k = -SEAM_REACH; k <= SEAM_REACH; k++) across += at(edge + k);
    const near: number[] = [];
    for (let k = SEAM_REACH + 8; k <= SEAM_REACH + 18; k++) near.push(at(edge - k), at(edge + k));
    near.sort((a, b) => a - b);
    return Math.max(0, across - (2 * SEAM_REACH + 1) * near[near.length >> 1]);
  };
  const right = part.left + part.width;
  const bottom = part.top + part.height;
  let worst = 0;
  if (part.left > 0) worst = Math.max(worst, side(true, part.left, part.top, bottom, W));
  if (right < W) worst = Math.max(worst, side(true, right, part.top, bottom, W));
  if (part.top > 0) worst = Math.max(worst, side(false, part.top, part.left, right, H));
  if (bottom < H) worst = Math.max(worst, side(false, bottom, part.left, right, H));
  return worst;
}

/**
 * How far the model's answer moved the original: its version of the original's
 * place against the original itself, both taken down to a small size, as a
 * share of full contrast (0 = the same picture in the same place). A flat
 * change of colour or brightness is not counted; a shift or a stretch is.
 * A model that shifts or rescales the whole scene gives new area that does
 * not line up with the original once that is pasted back.
 */
export async function driftOf(extended: Uint8Array, source: Uint8Array, placePx: PixelRect): Promise<number> {
  const meta = await sharp(Buffer.from(extended)).metadata();
  if (!meta.width || !meta.height) return 1;
  const p = await placed(source, { width: meta.width, height: meta.height }, placePx);
  if (!p) return 0;
  const N = 48;
  const a = await sharp(Buffer.from(extended)).removeAlpha().extract(p.part).raw().toBuffer()
    .then((buf) => sharp(buf, { raw: { width: p.part.width, height: p.part.height, channels: 3 } }).resize(N, N, { fit: "fill" }).raw().toBuffer());
  const b = await sharp(p.data, { raw: { width: p.part.width, height: p.part.height, channels: 3 } }).resize(N, N, { fit: "fill" }).raw().toBuffer();
  let total = 0;
  for (let c = 0; c < 3; c++) {
    let ma = 0, mb = 0;
    for (let i = c; i < a.length; i += 3) { ma += a[i]; mb += b[i]; }
    ma /= N * N;
    mb /= N * N;
    for (let i = c; i < a.length; i += 3) total += Math.abs(a[i] - ma - (b[i] - mb));
  }
  return total / (N * N * 3) / 255;
}

/**
 * How much MORE of the picture is the marks colour (bright magenta) after an
 * edit than before it, as a share of the box. The board's marks (Markup) and
 * the paint of the "tint" Erase are magenta; a model that leaves them in
 * (2026-11-18: Erase came back with the paint still on) must not get its
 * result saved. Compared with the original, so a picture that really has
 * magenta in it is not refused for that.
 */
export async function marksLeft(original: Uint8Array, edited: Uint8Array, box: Box): Promise<number> {
  const share = async (png: Uint8Array) => {
    const img = sharp(Buffer.from(png));
    const { width, height } = await img.metadata();
    if (!width || !height) return 0;
    const r = boxPixels(box, width, height, 0);
    const { data, info } = await sharp(Buffer.from(png)).extract(r).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      if (R > 180 && B > 180 && G < 110 && R - G > 110 && B - G > 110) n++;
    }
    return n / Math.max(1, info.width * info.height);
  };
  return Math.max(0, (await share(edited)) - (await share(original)));
}
