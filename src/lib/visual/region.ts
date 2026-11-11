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
 * Server-side (sharp); also used by the picture smoke test outside Next.
 */
import sharp from "sharp";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
 * The edited picture inside the box (soft edge of `feather` px), the original
 * everywhere else. Both are brought to the original's size first, so a model
 * that returns a different size can't shift anything.
 */
export async function keepOutside(original: Uint8Array, edited: Uint8Array, box: Box, feather = 12): Promise<Uint8Array> {
  const base = sharp(Buffer.from(original)).ensureAlpha();
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("The original picture couldn't be read.");
  const orig = await base.raw().toBuffer();
  const next = await sharp(Buffer.from(edited)).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const r = boxPixels(box, width, height, 0);
  const out = Buffer.from(orig);
  for (let y = r.top; y < r.top + r.height; y++) {
    for (let x = r.left; x < r.left + r.width; x++) {
      // Distance to the box edge sets how much of the edit shows: full inside, fading at the rim.
      const d = Math.min(x - r.left, r.left + r.width - 1 - x, y - r.top, r.top + r.height - 1 - y);
      const a = feather > 0 ? Math.min(1, (d + 1) / feather) : 1;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[i + c] = Math.round(orig[i + c] * (1 - a) + next[i + c] * a);
    }
  }
  return new Uint8Array(await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer());
}
