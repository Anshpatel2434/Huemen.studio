/**
 * The sums behind the picture tools on the Visual board (picture-tools-ui,
 * visual-comments-ui). Pure and client-safe: no DOM, no React, so every one of
 * them is tested (tests/picture-tools-ui.test.ts).
 *
 *   where a picture sits   a picture is shown cropped to its slot (object-cover)
 *                          or whole inside it (a cut-out, object-contain); a
 *                          point or a box on the screen is turned into a share
 *                          of the PICTURE, which is what the image model works on
 *   strokes                freehand points thinned to the cap the server takes
 *   resize                 where the picture sits in a new frame, from a zoom
 *                          and a centre, and what that asks for (crop or extend)
 *   drafts                 what the strip says before Send
 */
import type { Box } from "@/lib/visual/region-types";
import { MAX_STROKE_POINTS, MIN_EXTEND_COVER, RESIZE_RATIO, coversFrame, type PinKind, type Stroke } from "@/lib/visual/picture-tools";

export type Rect = { left: number; top: number; width: number; height: number };
export type Point = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;

// ---- where a picture sits -----------------------------------------------------------

/**
 * The WHOLE picture's rectangle, given the slot it is shown in. `cover` fills
 * the slot and is cropped by it (centred); `contain` sits whole inside it.
 * Same units as `slot`.
 */
export function pictureRectIn(slot: Rect, natural: { w: number; h: number }, fit: "cover" | "contain" = "cover"): Rect {
  if (!(natural.w > 0) || !(natural.h > 0)) return slot;
  const sx = slot.width / natural.w;
  const sy = slot.height / natural.h;
  const s = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  const width = natural.w * s;
  const height = natural.h * s;
  return { left: slot.left + (slot.width - width) / 2, top: slot.top + (slot.height - height) / 2, width, height };
}

/** The part two rectangles share, or null when they don't touch. */
export function overlap(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/**
 * Where a picture sits inside one visual, in the visual's own (unzoomed)
 * pixels: the frame it is on, the whole picture, and the part the layout
 * shows. The board is zoomed with a CSS transform, so the screen rectangles
 * are divided by the zoom (the wrapper's screen width over its layout width).
 */
export type PictureGeometry = {
  frame: Rect; full: Rect; seen: Rect;
  /** The surface's own height (a field low on it opens upwards). */
  height: number;
  natural: { w: number; h: number };
  /** The slot the layout gives the picture, width over height. */
  slot: number;
  /** Which of the visual's frames it is (a carousel's cover is the first). */
  frameIndex: number;
  /** The whole picture on its frame, in shares of the frame. */
  pic: Box;
};

/** The geometry from what was measured on screen (screen pixels), or null when there is nothing to work on. */
export function geometryFrom(m: {
  wrap: Rect; layoutWidth: number; layoutHeight: number;
  frame: Rect; full: Rect; slot: Rect; natural: { w: number; h: number }; frameIndex: number;
}): PictureGeometry | null {
  const z = m.wrap.width / (m.layoutWidth || m.wrap.width) || 1;
  const local = (r: Rect): Rect => ({ left: (r.left - m.wrap.left) / z, top: (r.top - m.wrap.top) / z, width: r.width / z, height: r.height / z });
  const frame = local(m.frame);
  const full = local(m.full);
  const slot = local(m.slot);
  if (!(frame.width > 0) || !(frame.height > 0) || !(slot.height > 0)) return null;
  return {
    frame, full, seen: overlap(full, slot) ?? slot, height: m.layoutHeight, natural: m.natural, slot: slot.width / slot.height,
    frameIndex: Math.max(0, m.frameIndex),
    pic: { x: (full.left - frame.left) / frame.width, y: (full.top - frame.top) / frame.height, w: full.width / frame.width, h: full.height / frame.height },
  };
}

/** Whether a screen point lands on the part of the picture the layout shows (`full` cropped by its `slot`). */
export function onShownPicture(full: Rect, slot: Rect, x: number, y: number): boolean {
  const seen = overlap(full, slot);
  return !!seen && x >= seen.left && x <= seen.left + seen.width && y >= seen.top && y <= seen.top + seen.height;
}

/** A point as a share of a rectangle, kept inside it. */
export function pointIn(full: Rect, x: number, y: number): Point {
  if (!(full.width > 0) || !(full.height > 0)) return [0, 0];
  return [round4(clamp((x - full.left) / full.width, 0, 1)), round4(clamp((y - full.top) / full.height, 0, 1))];
}

/** A rectangle as a share of another, keeping only the part inside it; null when none of it is. */
export function boxIn(full: Rect, r: Rect): Box | null {
  if (!(full.width > 0) || !(full.height > 0)) return null;
  const x0 = Math.max(0, (r.left - full.left) / full.width);
  const y0 = Math.max(0, (r.top - full.top) / full.height);
  const x1 = Math.min(1, (r.left + r.width - full.left) / full.width);
  const y1 = Math.min(1, (r.top + r.height - full.top) / full.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A box (shares of `of`) as a rectangle in `of`'s own units. */
export function rectOfBox(of: Rect, b: Box): Rect {
  return { left: of.left + b.x * of.width, top: of.top + b.y * of.height, width: b.w * of.width, height: b.h * of.height };
}

/**
 * A box on the picture, put back on the visual's frame. `pic` is where the
 * whole picture sits on that frame, in shares of the frame (it may start
 * before 0 or run past 1 where the layout crops it). Kept inside the frame,
 * and never thinner than a pin can hang on.
 */
export function areaOnFrame(area: Box, pic: Box): Box {
  const x0 = clamp(pic.x + area.x * pic.w, 0, 1);
  const y0 = clamp(pic.y + area.y * pic.h, 0, 1);
  const x1 = clamp(pic.x + (area.x + area.w) * pic.w, 0, 1);
  const y1 = clamp(pic.y + (area.y + area.h) * pic.h, 0, 1);
  const min = 0.02;
  const w = Math.max(min, x1 - x0);
  const h = Math.max(min, y1 - y0);
  return { x: Math.min(x0, 1 - w), y: Math.min(y0, 1 - h), w, h };
}

// ---- strokes --------------------------------------------------------------------------

/** How far the pointer must move (a share of the picture) before a new point is kept. */
export const STROKE_STEP = 0.004;

/** `pts` with `p` added, unless it is a hair from the last point. */
export function addPoint(pts: Point[], p: Point, step = STROKE_STEP): Point[] {
  const last = pts[pts.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < step) return pts;
  return [...pts, p];
}

/** How far `p` is from the line through `a` and `b` (from `a` when they are the same point). */
function off(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Ramer-Douglas-Peucker: the points that carry the shape, within `tolerance`. */
function thin(pts: Point[], tolerance: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let most = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = off(pts[i], pts[a], pts[b]);
      if (d > most) { most = d; far = i; }
    }
    if (far > 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * One stroke's points, ready to send: thinned to the ones that carry its shape
 * and never more than `cap` (the server refuses more). The first and last
 * points are always kept. A dab (one point) comes back as two, so it is still a line.
 */
export function simplifyStroke(pts: Point[], cap = MAX_STROKE_POINTS, tolerance = 0.0015): Point[] {
  const clean = pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p): Point => [round4(clamp(p[0], 0, 1)), round4(clamp(p[1], 0, 1))]);
  if (!clean.length) return [];
  if (clean.length === 1) return [clean[0], clean[0]];
  let out = thin(clean, tolerance);
  // Still too many (a long scribble): loosen the tolerance, then pick evenly.
  for (let t = tolerance * 2; out.length > cap && t < 0.05; t *= 2) out = thin(clean, t);
  if (out.length > cap) {
    const picked: Point[] = [];
    for (let i = 0; i < cap; i++) picked.push(out[Math.round((i * (out.length - 1)) / (cap - 1))]);
    out = picked;
  }
  return out;
}

/**
 * The box around some strokes on the picture, half a stroke's width wider all
 * round (a stroke's width is a share of the picture's SHORTER side, so the
 * picture's shape, width over height, is needed). Null when there are no points.
 */
export function strokesBox(strokes: Stroke[], aspect = 1): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const shape = aspect > 0 ? aspect : 1;
  for (const s of strokes) {
    const padX = (s.w / 2) * (shape >= 1 ? 1 / shape : 1);
    const padY = (s.w / 2) * (shape >= 1 ? 1 : shape);
    for (const [x, y] of s.pts) {
      x0 = Math.min(x0, x - padX); x1 = Math.max(x1, x + padX);
      y0 = Math.min(y0, y - padY); y1 = Math.max(y1, y + padY);
    }
  }
  if (!Number.isFinite(x0)) return null;
  x0 = clamp(x0, 0, 1); y0 = clamp(y0, 0, 1); x1 = clamp(x1, 0, 1); y1 = clamp(y1, 0, 1);
  return { x: round4(x0), y: round4(y0), w: round4(x1 - x0), h: round4(y1 - y0) };
}

/** A stroke as an SVG path, on a picture drawn `w` by `h` units. */
export function strokePath(pts: Point[], w: number, h: number): string {
  if (!pts.length) return "";
  const at = (p: Point) => `${(p[0] * w).toFixed(1)} ${(p[1] * h).toFixed(1)}`;
  // One point (or the same point twice) is a dot: a line to itself, drawn by its round cap.
  return `M ${at(pts[0])} ${(pts.length > 1 ? pts.slice(1) : pts).map((p) => `L ${at(p)}`).join(" ")}`;
}

// ---- a slider's values ------------------------------------------------------------------

export type Range = { min: number; max: number; step: number };

/** The value at a share (0..1) of a slider's track, on a step. */
export function rangeAt(share: number, r: Range): number {
  const v = r.min + clamp(Number.isFinite(share) ? share : 0, 0, 1) * (r.max - r.min);
  return clamp(Math.round(v / r.step) * r.step, r.min, r.max);
}

/** Where a key takes a slider: arrows one step, Page Up/Down two, Home and End the ends. Null for any other key. */
export function rangeForKey(value: number, key: string, r: Range): number | null {
  const by = (n: number) => clamp(Math.round((value + n * r.step) / r.step) * r.step, r.min, r.max);
  switch (key) {
    case "ArrowRight": case "ArrowUp": return by(1);
    case "ArrowLeft": case "ArrowDown": return by(-1);
    case "PageUp": return by(2);
    case "PageDown": return by(-2);
    case "Home": return r.min;
    case "End": return r.max;
    default: return null;
  }
}

// ---- resize -----------------------------------------------------------------------------

export type ShapeKey = "fit" | "square" | "portrait" | "landscape";
/** The shapes Resize offers. `fit` is the picture's own slot on the visual, measured on the board. */
export const RESIZE_SHAPES: readonly { key: ShapeKey; label: string; note: string; ratio: number | null }[] = [
  { key: "fit", label: "Fit this visual", note: "", ratio: null },
  { key: "square", label: "Square", note: "1:1", ratio: 1 },
  { key: "portrait", label: "Portrait", note: "4:5", ratio: 0.8 },
  { key: "landscape", label: "Landscape", note: "16:9", ratio: 1.75 },
];

/** Zoom, in percent of "the whole picture just inside the frame". */
export const RESIZE_ZOOM: Range = { min: 100, max: 300, step: 5 };

/** A frame shape the server takes (width over height), 1 when it can't be read. */
export function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 ? clamp(ratio, RESIZE_RATIO.min, RESIZE_RATIO.max) : 1;
}

/** The shape of the slot a layout gives the picture, from its measured size. */
export function slotRatio(width: number, height: number): number {
  return width > 0 && height > 0 ? clampRatio(Math.round((width / height) * 1000) / 1000) : 1;
}

/** The zoom (percent) at which the picture just covers the whole frame. */
export function coverZoom(ratio: number, aspect: number): number {
  return Math.max(aspect / ratio, ratio / aspect) * 100;
}

/**
 * Where the picture sits in the new frame, in shares of the frame.
 *
 *   ratio   the frame, width over height
 *   aspect  the picture, width over height
 *   zoom    percent; 100 is the whole picture just inside the frame
 *   cx, cy  where the picture's centre is asked to be
 *
 * The picture keeps its own shape. It is never dragged further than its edge:
 * where it is wider (or taller) than the frame it always spans it, and where
 * it is narrower it stays inside.
 */
export function placeAt(ratio: number, aspect: number, zoom: number, cx = 0.5, cy = 0.5): Box {
  const w = Math.min(1, aspect / ratio) * (clamp(zoom, RESIZE_ZOOM.min, RESIZE_ZOOM.max) / 100);
  const h = (w * ratio) / aspect;
  const along = (centre: number, size: number) => (size >= 1 ? clamp(centre - size / 2, 1 - size, 0) : clamp(centre - size / 2, 0, 1 - size));
  return { x: along(cx, w), y: along(cy, h), w, h };
}

/**
 * The zoom a shape opens at: the picture filling the frame (a crop, as the
 * visual shows it now), or as close as the slider goes.
 */
export function startZoom(ratio: number, aspect: number): number {
  return clamp(coverZoom(ratio, aspect), RESIZE_ZOOM.min, RESIZE_ZOOM.max);
}

/**
 * A zoom the slider can land on: its steps, plus the exact point where the
 * picture fills the frame (so "crop" is always one notch away, never missed
 * by a hair).
 */
export function snapZoom(zoom: number, ratio: number, aspect: number): number {
  const cover = coverZoom(ratio, aspect);
  const v = clamp(zoom, RESIZE_ZOOM.min, RESIZE_ZOOM.max);
  return cover <= RESIZE_ZOOM.max && Math.abs(v - cover) < RESIZE_ZOOM.step / 2 ? cover : v;
}

/** The share of the new frame the picture covers (0..1). */
export function frameCover(place: Box): number {
  const w = Math.min(1, place.x + place.w) - Math.max(0, place.x);
  const h = Math.min(1, place.y + place.h) - Math.max(0, place.y);
  return Math.max(0, w) * Math.max(0, h);
}

export type ResizeOutcome = "same" | "crop" | "extend" | "too_little";

/**
 * What a placement asks for:
 *   same        the picture already is this frame, nothing to do
 *   crop        it covers the frame: cut to it, free and at once
 *   extend      part of the frame is bare: that part is drawn (one picture)
 *   too_little  so little of the picture is left that a new one is the honest answer
 */
export function resizeOutcome(place: Box): ResizeOutcome {
  const e = 0.002;
  if (Math.abs(place.x) <= e && Math.abs(place.y) <= e && Math.abs(place.w - 1) <= e && Math.abs(place.h - 1) <= e) return "same";
  if (coversFrame(place)) return "crop";
  return frameCover(place) < MIN_EXTEND_COVER ? "too_little" : "extend";
}

/** The bare band of the frame with the most room, for the "Drawn to match" label; null when the frame is covered. */
export function widestGap(place: Box): { side: "left" | "right" | "top" | "bottom"; size: number } | null {
  const gaps = [
    { side: "left" as const, size: place.x },
    { side: "right" as const, size: 1 - (place.x + place.w) },
    { side: "top" as const, size: place.y },
    { side: "bottom" as const, size: 1 - (place.y + place.h) },
  ].filter((g) => g.size > 0.002);
  return gaps.length ? gaps.reduce((a, b) => (b.size > a.size ? b : a)) : null;
}

// ---- drafts -----------------------------------------------------------------------------

type DraftLike = { kind: PinKind; target: string; note: string };

/** A change to the picture itself (each one is one picture charge), not to the words or the design. */
export const isPicturePin = (d: DraftLike) => d.kind !== "comment" || d.target === "picture";
/** Erase needs no words; everything else does. */
export const needsNote = (d: DraftLike) => d.kind !== "erase";

/** What is waiting to be sent: how many changes, how many of them use a picture, how many still need their words. */
export function draftSummary(drafts: DraftLike[]): { changes: number; pictures: number; missing: number; ready: boolean } {
  const pictures = drafts.filter(isPicturePin).length;
  const missing = drafts.filter((d) => needsNote(d) && !d.note.trim()).length;
  return { changes: drafts.length, pictures, missing, ready: drafts.length > 0 && missing === 0 };
}

/** The strip's count, e.g. "3 changes · uses 2 pictures". Empty when nothing is waiting. */
export function summaryLine(drafts: DraftLike[]): string {
  const s = draftSummary(drafts);
  if (!s.changes) return "";
  return [
    `${s.changes} change${s.changes === 1 ? "" : "s"}`,
    s.pictures ? `uses ${s.pictures} picture${s.pictures === 1 ? "" : "s"}` : "",
    s.missing ? `${s.missing} need${s.missing === 1 ? "s" : ""} a comment` : "",
  ].filter(Boolean).join(" · ");
}
