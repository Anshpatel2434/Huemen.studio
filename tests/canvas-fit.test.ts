/**
 * The canvas fit maths (components/canvas-fit). 2026-11-19: "Zoom to fit" did
 * nothing on the pillar map at 1440x900: it used the opening view's rule,
 * which lands on the map's invisible readable-width frame (zero height) at
 * 100%, the zoom the map already opened at. Zoom to fit is now the whole
 * stage, on every canvas.
 */
import { describe, expect, it } from "vitest";
import { fitAll, fitOpen, FIT_BOTTOM, FIT_TOP, MIN_FIT_ZOOM, MIN_OPEN_ZOOM } from "@/components/canvas-fit";

/** The pillar map's canvas at 1440x900 with both panels open (measured live, roughly) and its stage. */
const WRAP = { w: 832, h: 836 };
const MAP = { w: 3200, h: 1500 };
/** The invisible frame the map opens on: READABLE_SPAN wide, zero high, centred, at the top. */
const FRAME = { x: (MAP.w - 1180) / 2, y: 0, w: 1180, h: 0 };

/** The stage, scaled and panned, inside the room between the strips (1px of rounding allowed). */
function inView(view: { zoom: number; pan: { x: number; y: number } }, wrap: { w: number; h: number }, stage: { w: number; h: number }) {
  const left = view.pan.x, top = view.pan.y;
  const right = left + stage.w * view.zoom, bottom = top + stage.h * view.zoom;
  return left >= -1 && right <= wrap.w + 1 && top >= FIT_TOP - 1 && bottom <= wrap.h - FIT_BOTTOM + 1;
}

describe("Zoom to fit: the whole stage", () => {
  it("the pillar map at 1440x900 fits whole, not the frame it opens on", () => {
    const open = fitOpen(WRAP, MAP, FRAME);
    const all = fitAll(WRAP, MAP);
    expect(all.zoom).toBeLessThan(open.zoom);
    expect(inView(all, WRAP, MAP)).toBe(true);
    expect(all.zoom).toBeCloseTo(0.23, 2);
  });

  it("changes the view even when the board opened at 100% on its frame (a wide canvas)", () => {
    const wide = { w: 1440, h: 836 };
    const open = fitOpen(wide, MAP, FRAME);
    expect(open.zoom).toBe(1);
    const all = fitAll(wide, MAP);
    expect(all.zoom).toBeLessThan(1);
    expect(inView(all, wide, MAP)).toBe(true);
  });

  it("a small stage is never blown up past 100%, and sits centred", () => {
    const v = fitAll({ w: 1200, h: 800 }, { w: 400, h: 300 });
    expect(v.zoom).toBe(1);
    expect(v.pan.x).toBe((1200 - 400) / 2);
    expect(inView(v, { w: 1200, h: 800 }, { w: 400, h: 300 })).toBe(true);
  });

  it("never below the minimum, however big the stage", () => {
    expect(fitAll(WRAP, { w: 40000, h: 20000 }).zoom).toBe(MIN_FIT_ZOOM);
  });

  it("the zoom is rounded down, so the rounded view still fits", () => {
    for (const w of [1000, 1999, 2345, 3211, 4100]) {
      for (const h of [700, 1234, 1777]) {
        const v = fitAll(WRAP, { w, h });
        if (v.zoom > MIN_FIT_ZOOM) expect(inView(v, WRAP, { w, h }), `${w}x${h}`).toBe(true);
      }
    }
  });

  it("Content and Visual canvases: every artboard in view, not only the first", () => {
    const wrap = { w: 1100, h: 836 };
    const stage = { w: 4 * 1080 + 3 * 80 + 80, h: 1350 + 120 };
    const first = { x: 40, y: 60, w: 1080, h: 1350 };
    expect(fitOpen(wrap, stage, first).zoom).toBeGreaterThan(fitAll(wrap, stage).zoom);
    expect(inView(fitAll(wrap, stage), wrap, stage)).toBe(true);
  });

  it("works on a phone too (the whole stage, at the minimum at worst)", () => {
    const phone = { w: 375, h: 700 };
    const v = fitAll(phone, MAP);
    expect(v.zoom).toBe(MIN_FIT_ZOOM);
    expect(v.pan.x).toBeGreaterThanOrEqual(12);
  });
});

describe("the opening view is unchanged", () => {
  it("lands on the first artboard at a readable size when the whole stage would be under half", () => {
    const v = fitOpen(WRAP, MAP, FRAME);
    expect(v.zoom).toBe(Math.round(((WRAP.w - 80) / FRAME.w) * 100) / 100);
    expect(v.pan.x).toBeCloseTo(40 - FRAME.x * v.zoom);
    expect(v.pan.y).toBe(FIT_TOP);
  });
  it("shows everything when it stays readable", () => {
    const v = fitOpen({ w: 1400, h: 900 }, { w: 1000, h: 600 }, { x: 0, y: 0, w: 400, h: 600 });
    expect(v.zoom).toBe(1);
  });
  it("on a phone, the first artboard, centred, never under its minimum", () => {
    const v = fitOpen({ w: 375, h: 700 }, { w: 4000, h: 1500 }, { x: 40, y: 60, w: 1080, h: 1350 });
    expect(v.zoom).toBe(MIN_OPEN_ZOOM);
    expect(v.pan.x).toBeCloseTo(Math.max(12, (375 - 1080 * MIN_OPEN_ZOOM) / 2) - 40 * MIN_OPEN_ZOOM);
  });
});
