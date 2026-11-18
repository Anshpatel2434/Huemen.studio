/**
 * Words in a picture that must have none (2026-11-19).
 *
 * A picture drawn to sit under live text ("live_text") is told to carry no
 * words, and the image model still prints one now and then ("qualified" on a
 * cup label, 2026-11-18). After drawing, a vision model looks for text
 * (lib/ai/tasks picture_text_check) and answers with boxes; lib/data/pictures
 * erases those boxes with the Erase path (outside them, every pixel is the
 * original) and checks once more.
 *
 * This module is the pure half: the boxes the model gives, read into shares
 * of the picture (models answer in fractions, in thousandths or in pixels,
 * whatever they are asked), grown so the erase covers the whole word, and
 * the board's notice when words are still there. Client-safe: no sharp.
 */
import type { Box } from "./region-types";

/** At most this many patches of text are erased in one go. */
export const MAX_WORD_BOXES = 8;
/** Each box is grown by this share of its own size on every side: the boxes a vision model gives are rough (live, one sat 0.03 above its word), and the erase removes only writing, so room costs nothing. */
export const WORD_PAD = 0.5;
/** ...and by at least this share of the picture's shorter side, so a tiny label is covered whole. */
export const WORD_PAD_MIN = 0.03;
/** A box bigger than this share of the picture is not a word: it is the model misreading the scene. Never erased. */
export const WORD_BOX_MAX_AREA = 0.45;

/** What the board says under a visual whose picture may still show words. */
export const WORDS_NOTICE = "This picture may show some words. Use Erase to remove them.";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

type Raw = { x?: unknown; y?: unknown; w?: unknown; h?: unknown };

/**
 * The model's boxes as shares of the picture, grown by WORD_PAD and kept
 * inside it. `sent` is the size of the copy the model looked at, in pixels:
 *   - every number at most 1000: thousandths, as asked (lib/ai/tasks
 *     picture_text_check), unless every one is at most 1: fractions;
 *   - else pixels of the copy it looked at.
 * Boxes that can't be read, that start outside the picture, or that cover
 * most of it are dropped. `aspect` is the picture's width over its height
 * (for the minimum pad).
 */
export function wordBoxes(raw: unknown, sent: { width: number; height: number }, aspect = 1): Box[] {
  if (!Array.isArray(raw)) return [];
  const nums = raw
    .map((b: Raw) => [b?.x, b?.y, b?.w, b?.h].map(Number))
    .filter((v) => v.every((n) => Number.isFinite(n)) && v[2] > 0 && v[3] > 0);
  if (!nums.length) return [];
  const top = Math.max(...nums.flat());
  const sx = top <= 1.001 ? 1 : top <= 1000 ? 1000 : sent.width || 1000;
  const sy = top <= 1.001 ? 1 : top <= 1000 ? 1000 : sent.height || 1000;
  const shape = aspect > 0 ? aspect : 1;
  // WORD_PAD_MIN is a share of the shorter side: as a share of each side.
  const minX = WORD_PAD_MIN * (shape >= 1 ? 1 / shape : 1);
  const minY = WORD_PAD_MIN * (shape >= 1 ? 1 : shape);
  const out: Box[] = [];
  for (const [x, y, w, h] of nums) {
    const bx = x / sx, by = y / sy, bw = w / sx, bh = h / sy;
    // Starts off the picture (live, a box at y = 1000), or is most of it: not a word to erase.
    if (bx < -0.01 || by < -0.01 || bx >= 0.99 || by >= 0.99 || bw * bh > WORD_BOX_MAX_AREA) continue;
    const px = Math.max(minX, bw * WORD_PAD);
    const py = Math.max(minY, bh * WORD_PAD);
    const x0 = clamp01(bx - px), y0 = clamp01(by - py);
    const x1 = clamp01(bx + bw + px), y1 = clamp01(by + bh + py);
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) continue;
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    if (out.length >= MAX_WORD_BOXES) break;
  }
  return out;
}

/** The widest a group of boxes erased in one call may be (a share of the picture's side). */
export const WORD_GROUP_SIDE = 0.35;
/** At most this many erase calls for the words of one picture (each is one paid picture). */
export const MAX_WORD_ERASES = 3;

/**
 * The boxes in groups that are each erased in one call. The erase model works
 * on a close-up of what it is given; boxes far apart in one call make that
 * close-up most of the picture, and a word in it too small to remove (live,
 * 2026-11-19: four boxes in one call left "quali" half there). Boxes join a
 * group while the group still fits in WORD_GROUP_SIDE each way. Biggest
 * group (by area) first; at most MAX_WORD_ERASES groups.
 */
export function wordGroups(boxes: Box[]): Box[][] {
  const groups: { boxes: Box[]; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const b of boxes) {
    const fit = groups.find((g) =>
      Math.max(g.x1, b.x + b.w) - Math.min(g.x0, b.x) <= WORD_GROUP_SIDE && Math.max(g.y1, b.y + b.h) - Math.min(g.y0, b.y) <= WORD_GROUP_SIDE);
    if (fit) {
      fit.boxes.push(b);
      fit.x0 = Math.min(fit.x0, b.x); fit.y0 = Math.min(fit.y0, b.y);
      fit.x1 = Math.max(fit.x1, b.x + b.w); fit.y1 = Math.max(fit.y1, b.y + b.h);
    } else {
      groups.push({ boxes: [b], x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
    }
  }
  const area = (g: { boxes: Box[] }) => g.boxes.reduce((n, b) => n + b.w * b.h, 0);
  return groups.sort((a, b) => area(b) - area(a)).slice(0, MAX_WORD_ERASES).map((g) => g.boxes);
}

/** The part of each box inside `area` (an area edit may only change its own area); boxes outside it are dropped. */
export function boxesWithin(boxes: Box[], area: Box): Box[] {
  return boxes.flatMap((b) => {
    const x0 = Math.max(b.x, area.x), y0 = Math.max(b.y, area.y);
    const x1 = Math.min(b.x + b.w, area.x + area.w), y1 = Math.min(b.y + b.h, area.y + area.h);
    return x1 - x0 > 0.002 && y1 - y0 > 0.002 ? [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }] : [];
  });
}
