/**
 * The picture tools on the Visual board (2026-11-18): Comment (several pins,
 * one Send), Markup, Erase, Remove background and Resize. This file is the
 * contract between the board (client) and the picture actions (server): the
 * shapes that cross the wire and their limits. Pure and client-safe: no I/O,
 * no sharp.
 *
 * Coordinates are fractions (0..1). `box` is on the VISUAL's frame (where the
 * pin shows); `area` and `strokes` are on the PICTURE itself (what the image
 * model changes), which differ because the picture is cropped to its slot.
 */
import type { Box } from "./region-types";

export type { Box };

/** What a picture pin asks for. */
export type PinKind = "comment" | "markup" | "erase";
export const PIN_KINDS: readonly PinKind[] = ["comment", "markup", "erase"];

/**
 * One freehand stroke on the picture. `w` is the stroke's width as a fraction
 * of the picture's shorter side; `pts` are [x, y] fractions of the picture.
 */
export interface Stroke {
  w: number;
  pts: [number, number][];
}

/** One pin on a picture, as the board sends it. */
export interface PicturePin {
  kind: PinKind;
  /** Where the pin shows, on the visual's frame. */
  box: Box;
  /** The same place on the picture itself; null when it could not be worked out (the server then uses `box`). */
  area: Box | null;
  /** Markup: the drawn marks. Erase: the brushed area. Absent for a comment. */
  strokes?: Stroke[];
  /** What to change. Erase needs none (the server writes its own). */
  note: string;
}

/** The most pins one Send carries (each picture pin is one picture charge). */
export const MAX_PINS_PER_SEND = 8;
export const MAX_STROKES = 12;
export const MAX_STROKE_POINTS = 64;
/** A stroke's width, as a fraction of the picture's shorter side. */
export const STROKE_WIDTH = { min: 0.004, max: 0.2 } as const;
/** The pen (Markup) and the brush (Erase) the board draws with. */
export const PEN_WIDTH = 0.008;
export const BRUSH_WIDTH = 0.06;
/** The note a brushed area is stored with (the person types nothing). */
export const ERASE_NOTE = "Erase what is brushed over";

/**
 * Resize. `ratio` is the new frame's width divided by its height. `place` is
 * where the CURRENT picture sits in the new frame, as fractions of the frame:
 * it may start before 0 or run past 1 (those parts are cropped away). Its
 * shape is the picture's own (the server keeps `place.w` and works out the
 * height). The frame is fully covered = a crop (free, done at once);
 * otherwise the uncovered part is drawn by the image model (one picture).
 */
export interface ResizeInput {
  ratio: number;
  place: Box;
}
export const RESIZE_RATIO = { min: 0.4, max: 2.5 } as const;
/** Below this share of the new frame, extending is refused: draw a new picture instead. */
export const MIN_EXTEND_COVER = 0.4;

/** True when the placed picture covers the whole new frame (so nothing has to be drawn). */
export function coversFrame(place: Box): boolean {
  const e = 0.002;
  return place.x <= e && place.y <= e && place.x + place.w >= 1 - e && place.y + place.h >= 1 - e;
}

/** How a picture version came to be, for the versions strip. */
export type PictureOp = "draw" | "area" | "markup" | "erase" | "resize" | "cutout";
export const PICTURE_OP_LABEL: Record<PictureOp, string> = {
  draw: "new picture",
  area: "area change",
  markup: "markup change",
  erase: "erased",
  resize: "resized",
  cutout: "background removed",
};

/**
 * Remove background: the share of the picture the cut-out keeps (0..1). Under
 * `min` nothing was found; over `max` nearly everything was kept. Either way
 * there is no clear subject to cut out, and the picture is left as it is.
 */
export const CUTOUT_COVERAGE = { min: 0.03, max: 0.9 } as const;
export function clearSubject(coverage: number): boolean {
  return Number.isFinite(coverage) && coverage >= CUTOUT_COVERAGE.min && coverage <= CUTOUT_COVERAGE.max;
}

/** Whether Remove background can run here, and why not when it can't (shown on the disabled tool). */
export interface CutoutStatus {
  available: boolean;
  reason: string | null;
}
