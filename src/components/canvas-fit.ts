/**
 * The canvas's fit maths, pure (components/canvas measures, this decides), so
 * a test can check it without a browser.
 *
 * Two fits, on purpose different:
 *   - fitAll: "Zoom to fit" (menu, Shift+1). The WHOLE stage in view, never
 *     below MIN_FIT_ZOOM. 2026-11-19: on the pillar map it did nothing at
 *     1440x900, because it used the opening view's rule below and that lands
 *     on an invisible readable-width frame at 100%, the zoom it was already at.
 *   - fitOpen: the view a board opens on. Everything when it stays readable
 *     (half size or more); otherwise the first artboard at a readable size with
 *     the rest a pan away; on a phone, the first artboard, centred.
 */

/** The smallest zoom any fit chooses: below this nothing on a card can be read or clicked. */
export const MIN_FIT_ZOOM = 0.2;
/** The smallest zoom the opening view chooses for its first artboard. */
export const MIN_OPEN_ZOOM = 0.35;
/** Strips of controls along the top and the bottom of the canvas: fitted content sits between them. */
export const FIT_TOP = 72;
export const FIT_BOTTOM = 72;

export interface View { zoom: number; pan: { x: number; y: number } }
export interface Box { w: number; h: number }
/** The first artboard on the stage: where it sits (unscaled) and its size. */
export interface Artboard { x: number; y: number; w: number; h: number }

const isPhone = (wrap: Box) => wrap.w < 640;
const gutterOf = (wrap: Box) => (isPhone(wrap) ? 24 : 80);
const roomOf = (wrap: Box) => ({ w: wrap.w - gutterOf(wrap), h: wrap.h - FIT_TOP - FIT_BOTTOM });
/** Down to whole percent, so the rounded zoom still fits (rounding up could cut the edge off). */
const floorPct = (z: number) => Math.floor(z * 100 + 1e-9) / 100;

/** Zoom to fit: the whole stage, centred across, from the top strip down; 100% at most, MIN_FIT_ZOOM at least. */
export function fitAll(wrap: Box, stage: Box): View {
  const room = roomOf(wrap);
  const sw = Math.max(1, stage.w), sh = Math.max(1, stage.h);
  const zoom = Math.max(MIN_FIT_ZOOM, Math.min(1, floorPct(Math.min(room.w / sw, room.h / sh))));
  // Centred when it fits the canvas at all (at the minimum zoom it may only just: then the gutter gives way first).
  const x = sw * zoom <= wrap.w ? (wrap.w - sw * zoom) / 2 : gutterOf(wrap) / 2;
  const y = FIT_TOP + Math.max(0, (room.h - sh * zoom) / 2);
  return { zoom, pan: { x, y } };
}

/** The opening view (and its refit when a panel docks): see the file comment. */
export function fitOpen(wrap: Box, stage: Box, first: Artboard | null): View {
  const room = roomOf(wrap);
  const phone = isPhone(wrap);
  const all = Math.min(1, room.w / Math.max(1, stage.w), room.h / Math.max(1, stage.h));
  if (first && (phone || all < 0.5)) {
    // Keep the row above it (its piece's label and actions) in view too.
    const lead = Math.min(first.y, 76);
    const z = Math.min(1, room.w / Math.max(1, first.w), room.h / Math.max(1, first.h + lead));
    const zoom = Math.max(MIN_OPEN_ZOOM, Math.round(z * 100) / 100);
    const left = phone ? Math.max(12, (wrap.w - first.w * zoom) / 2) : gutterOf(wrap) / 2;
    return { zoom, pan: { x: left - first.x * zoom, y: FIT_TOP - (first.y - lead) * zoom } };
  }
  const zoom = Math.max(MIN_FIT_ZOOM, Math.round(all * 100) / 100);
  return { zoom, pan: { x: Math.max(gutterOf(wrap) / 2, (wrap.w - stage.w * zoom) / 2), y: FIT_TOP } };
}
