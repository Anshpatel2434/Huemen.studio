/**
 * The sums behind the picture tools on the Visual board
 * (src/app/w/[id]/p/[pid]/visual/picture-tools-maths.ts), 2026-11-18:
 *
 *   - where a picture sits in its slot (cropped to fill, or whole for a
 *     cut-out), and a point or a box as a share of the PICTURE
 *   - strokes thinned to the cap the server takes, and their box
 *   - Resize: where the picture sits in a new frame from zoom and centre,
 *     never dragged past its edge; crop, extend or refuse
 *   - what the strip says before Send
 */
import { describe, it, expect } from "vitest";
import {
  RESIZE_SHAPES, RESIZE_ZOOM, addPoint, areaOnFrame, boxIn, clampRatio, coverZoom, draftSummary, frameCover, geometryFrom, isPicturePin, needsNote, onShownPicture, overlap,
  pictureRectIn, placeAt, pointIn, rangeAt, rangeForKey, rectOfBox, resizeOutcome, simplifyStroke, slotRatio, snapZoom, startZoom, strokePath,
  strokesBox, summaryLine, widestGap, type Point,
} from "@/app/w/[id]/p/[pid]/visual/picture-tools-maths";
import { MAX_STROKE_POINTS, MIN_EXTEND_COVER, RESIZE_RATIO, coversFrame } from "@/lib/visual/picture-tools";

const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

describe("where the picture sits in its slot", () => {
  const slot = { left: 0, top: 0, width: 300, height: 300 };
  it("cover: a wide picture fills the slot's height and is cropped at the sides, centred", () => {
    const r = pictureRectIn(slot, { w: 2000, h: 1000 });
    expect(r).toEqual({ left: -150, top: 0, width: 600, height: 300 });
  });
  it("contain (a cut-out): the whole picture sits inside, centred", () => {
    const r = pictureRectIn(slot, { w: 2000, h: 1000 }, "contain");
    expect(r).toEqual({ left: 0, top: 75, width: 300, height: 150 });
  });
  it("a point is a share of the WHOLE picture, kept on it", () => {
    const full = pictureRectIn(slot, { w: 2000, h: 1000 });
    // The slot's centre is the picture's centre.
    expect(pointIn(full, 150, 150)).toEqual([0.5, 0.5]);
    // The slot's left edge is a quarter of the way into the cropped picture.
    expect(pointIn(full, 0, 0)).toEqual([0.25, 0]);
    expect(pointIn(full, -9999, 9999)).toEqual([0, 1]);
  });
  it("a box keeps only the part on the picture; none of it is null", () => {
    const full = { left: 100, top: 100, width: 200, height: 100 };
    expect(boxIn(full, { left: 150, top: 125, width: 100, height: 50 })).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(boxIn(full, { left: 50, top: 100, width: 100, height: 100 })).toEqual({ x: 0, y: 0, w: 0.25, h: 1 });
    expect(boxIn(full, { left: 0, top: 0, width: 50, height: 50 })).toBeNull();
  });
  it("overlap and rectOfBox", () => {
    expect(overlap({ left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 })).toEqual({ left: 5, top: 5, width: 5, height: 5 });
    expect(overlap({ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 0, width: 5, height: 5 })).toBeNull();
    expect(rectOfBox({ left: 10, top: 20, width: 100, height: 200 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toEqual({ left: 60, top: 120, width: 10, height: 20 });
  });
  it("a box on the picture goes back on the frame through where the picture sits", () => {
    // The picture fills the top half of the frame.
    const b = areaOnFrame({ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, { x: 0, y: 0, w: 1, h: 0.5 });
    expect(near(b.x, 0.5) && near(b.y, 0.25) && near(b.w, 0.2) && near(b.h, 0.1)).toBe(true);
    // A cropped picture: the part off the frame is cut, never past its edge, never thinner than a pin.
    const c = areaOnFrame({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: -0.5, y: 0, w: 2, h: 1 });
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.w).toBeGreaterThanOrEqual(0.02);
    expect(c.x + c.w).toBeLessThanOrEqual(1);
  });
});

describe("measured at the click (the first click after picking a tool, 2026-11-19)", () => {
  // A visual drawn at half size (the board zoomed to 50%): 400 x 500 on screen, 800 x 1000 in layout.
  const wrap = { left: 100, top: 50, width: 400, height: 500 };
  const frame = { left: 100, top: 50, width: 400, height: 500 };
  // The picture fills the top half of the frame (its slot), cropped at the sides.
  const slot = { left: 100, top: 50, width: 400, height: 250 };
  const natural = { w: 2000, h: 1000 };
  const full = pictureRectIn(slot, natural);
  it("puts the picture in the visual's own pixels, through the zoom, the same sums the overlay uses", () => {
    const g = geometryFrom({ wrap, layoutWidth: 800, layoutHeight: 1000, frame, full, slot, natural, frameIndex: 0 })!;
    expect(g.frame).toEqual({ left: 0, top: 0, width: 800, height: 1000 });
    expect(g.full).toEqual({ left: -100, top: 0, width: 1000, height: 500 });
    expect(g.seen).toEqual({ left: 0, top: 0, width: 800, height: 500 });
    expect(g.slot).toBeCloseTo(1.6, 6);
    expect(g.natural).toEqual(natural);
    expect(g.height).toBe(1000);
    expect(g.pic).toEqual({ x: -0.125, y: 0, w: 1.25, h: 0.5 });
  });
  it("says nothing when the frame or the slot has no size yet, and never gives a negative frame index", () => {
    expect(geometryFrom({ wrap, layoutWidth: 800, layoutHeight: 1000, frame: { ...frame, width: 0 }, full, slot, natural, frameIndex: 0 })).toBeNull();
    expect(geometryFrom({ wrap, layoutWidth: 800, layoutHeight: 1000, frame, full, slot: { ...slot, height: 0 }, natural, frameIndex: 0 })).toBeNull();
    expect(geometryFrom({ wrap, layoutWidth: 0, layoutHeight: 0, frame, full, slot, natural, frameIndex: -1 })!.frameIndex).toBe(0);
  });
  it("a click counts as on the picture only on the part the layout shows", () => {
    expect(onShownPicture(full, slot, 300, 100)).toBe(true);
    expect(onShownPicture(full, slot, 100, 50)).toBe(true);
    // Below the picture's slot (the words), and on the cropped-off part outside the slot.
    expect(onShownPicture(full, slot, 300, 400)).toBe(false);
    expect(onShownPicture(full, slot, 60, 100)).toBe(false);
  });
});

describe("strokes", () => {
  it("a hair's move adds no point", () => {
    const pts: Point[] = [[0.5, 0.5]];
    expect(addPoint(pts, [0.5001, 0.5])).toBe(pts);
    expect(addPoint(pts, [0.52, 0.5])).toHaveLength(2);
  });
  it("a straight line thins to its two ends", () => {
    const line: Point[] = Array.from({ length: 50 }, (_, i) => [i / 49, 0.5]);
    expect(simplifyStroke(line)).toEqual([[0, 0.5], [1, 0.5]]);
  });
  it("a long scribble never passes the cap, and keeps its first and last points", () => {
    const wiggle: Point[] = Array.from({ length: 2000 }, (_, i) => [i / 1999, 0.5 + 0.3 * Math.sin(i / 3) * ((i % 7) / 7)]);
    const out = simplifyStroke(wiggle);
    expect(out.length).toBeLessThanOrEqual(MAX_STROKE_POINTS);
    expect(out[0]).toEqual([0, 0.5]);
    expect(out[out.length - 1][0]).toBe(1);
  });
  it("a circle keeps its shape", () => {
    const circle: Point[] = Array.from({ length: 200 }, (_, i) => [0.5 + 0.3 * Math.cos((i / 199) * 2 * Math.PI), 0.5 + 0.3 * Math.sin((i / 199) * 2 * Math.PI)]);
    const out = simplifyStroke(circle);
    expect(out.length).toBeGreaterThan(8);
    expect(out.length).toBeLessThanOrEqual(MAX_STROKE_POINTS);
    for (const [x, y] of out) expect(Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.3)).toBeLessThan(0.01);
  });
  it("a dab is still a line; points off the picture are kept on it; junk is dropped", () => {
    expect(simplifyStroke([[0.2, 0.3]])).toEqual([[0.2, 0.3], [0.2, 0.3]]);
    expect(simplifyStroke([[-1, 2], [0.5, 0.5]])).toEqual([[0, 1], [0.5, 0.5]]);
    expect(simplifyStroke([[Number.NaN, 0.5]])).toEqual([]);
  });
  it("the box around strokes includes half their width, on the shorter side", () => {
    const b = strokesBox([{ w: 0.1, pts: [[0.4, 0.4], [0.6, 0.6]] }], 1)!;
    expect(near(b.x, 0.35) && near(b.y, 0.35) && near(b.w, 0.3) && near(b.h, 0.3)).toBe(true);
    // A wide picture (2:1): the width is a share of its height, so it is half as much of its width.
    const w = strokesBox([{ w: 0.1, pts: [[0.5, 0.5]] }], 2)!;
    expect(near(w.w, 0.05) && near(w.h, 0.1)).toBe(true);
    expect(strokesBox([], 1)).toBeNull();
    // Kept on the picture.
    const edge = strokesBox([{ w: 0.2, pts: [[0, 0]] }], 1)!;
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
  });
  it("draws as an SVG path in the picture's units", () => {
    expect(strokePath([[0, 0], [0.5, 1]], 200, 100)).toBe("M 0.0 0.0 L 100.0 100.0");
    expect(strokePath([[0.5, 0.5]], 10, 10)).toBe("M 5.0 5.0 L 5.0 5.0");
    expect(strokePath([], 10, 10)).toBe("");
  });
});

describe("a slider's values (Resize's zoom)", () => {
  it("a point on the track is a value on a step", () => {
    expect(rangeAt(0, RESIZE_ZOOM)).toBe(100);
    expect(rangeAt(1, RESIZE_ZOOM)).toBe(300);
    expect(rangeAt(0.5, RESIZE_ZOOM)).toBe(200);
    expect(rangeAt(-3, RESIZE_ZOOM)).toBe(100);
    expect(rangeAt(Number.NaN, RESIZE_ZOOM)).toBe(100);
  });
  it("keys move it like a native slider", () => {
    expect(rangeForKey(150, "ArrowRight", RESIZE_ZOOM)).toBe(155);
    expect(rangeForKey(150, "ArrowDown", RESIZE_ZOOM)).toBe(145);
    expect(rangeForKey(150, "PageUp", RESIZE_ZOOM)).toBe(160);
    expect(rangeForKey(150, "Home", RESIZE_ZOOM)).toBe(100);
    expect(rangeForKey(150, "End", RESIZE_ZOOM)).toBe(300);
    expect(rangeForKey(300, "ArrowUp", RESIZE_ZOOM)).toBe(300);
    expect(rangeForKey(150, "x", RESIZE_ZOOM)).toBeNull();
  });
});

describe("resize: where the picture sits in a new frame", () => {
  it("the shapes: Fit this visual first, then square, portrait 4:5, landscape 16:9", () => {
    expect(RESIZE_SHAPES.map((s) => s.key)).toEqual(["fit", "square", "portrait", "landscape"]);
    expect(RESIZE_SHAPES.map((s) => s.ratio)).toEqual([null, 1, 0.8, 1.75]);
    expect(RESIZE_SHAPES[0].label).toBe("Fit this visual");
  });
  it("a slot's shape is its measured width over height, inside what the server takes", () => {
    expect(slotRatio(300, 375)).toBe(0.8);
    expect(slotRatio(1584, 396)).toBe(RESIZE_RATIO.max);
    expect(slotRatio(0, 10)).toBe(1);
    expect(clampRatio(0.1)).toBe(RESIZE_RATIO.min);
    expect(clampRatio(Number.NaN)).toBe(1);
  });
  it("at 100% the whole picture is just inside the frame, centred", () => {
    // A square picture in a 16:9 frame: full height, bands at the sides.
    const p = placeAt(16 / 9, 1, 100);
    expect(near(p.h, 1) && near(p.y, 0)).toBe(true);
    expect(near(p.w, 9 / 16)).toBe(true);
    expect(near(p.x, (1 - 9 / 16) / 2)).toBe(true);
    // The picture keeps its own shape: w/h in frame shares times the frame's shape is the picture's.
    expect(near((p.w / p.h) * (16 / 9), 1)).toBe(true);
  });
  it("the zoom that covers the frame is a crop; one notch less is an extension", () => {
    const ratio = 16 / 9, aspect = 1;
    const cover = coverZoom(ratio, aspect);
    expect(near(cover, (16 / 9) * 100)).toBe(true);
    expect(coversFrame(placeAt(ratio, aspect, cover))).toBe(true);
    expect(resizeOutcome(placeAt(ratio, aspect, cover))).toBe("crop");
    expect(resizeOutcome(placeAt(ratio, aspect, cover - 5))).toBe("extend");
  });
  it("opens on the crop (the picture filling the frame, as the visual shows it now)", () => {
    expect(near(startZoom(0.8, 1), 125)).toBe(true);
    expect(resizeOutcome(placeAt(0.8, 1, startZoom(0.8, 1)))).toBe("crop");
    // Too far to fill within the slider (a 2.5:1 frame on a 1:2 picture): as close as it goes.
    expect(startZoom(2.5, 0.5)).toBe(RESIZE_ZOOM.max);
  });
  it("the slider snaps to the exact cover zoom, so a crop is never missed by a hair", () => {
    const cover = coverZoom(0.8, 1); // 125
    expect(snapZoom(124, 0.8, 1)).toBe(cover);
    expect(snapZoom(130, 0.8, 1)).toBe(130);
    expect(snapZoom(999, 0.8, 1)).toBe(RESIZE_ZOOM.max);
  });
  it("the picture is never dragged past its edge", () => {
    // Wider than the frame: it always spans it.
    const wide = placeAt(1, 2, 100, -5, 0.5);
    expect(wide.x).toBeLessThanOrEqual(0);
    expect(wide.x + wide.w).toBeGreaterThanOrEqual(1 - 1e-9);
    // Narrower than the frame: it stays inside.
    const narrow = placeAt(16 / 9, 1, 100, 5, 0.5);
    expect(narrow.x + narrow.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(narrow.x).toBeGreaterThanOrEqual(0);
  });
  it("the same shape at the same place is nothing to do", () => {
    expect(resizeOutcome({ x: 0, y: 0, w: 1, h: 1 })).toBe("same");
  });
  it("refuses an extension that leaves too little of the picture", () => {
    // A 1:2 picture in a 2.5:1 frame at 100%: a sliver.
    const p = placeAt(2.5, 0.5, 100);
    expect(frameCover(p)).toBeLessThan(MIN_EXTEND_COVER);
    expect(resizeOutcome(p)).toBe("too_little");
  });
  it("covered share and the widest bare band", () => {
    expect(near(frameCover({ x: 0.25, y: 0, w: 0.5, h: 1 }), 0.5)).toBe(true);
    expect(near(frameCover({ x: -0.5, y: -0.5, w: 2, h: 2 }), 1)).toBe(true);
    expect(widestGap({ x: 0.1, y: 0, w: 0.6, h: 1 })).toEqual({ side: "right", size: expect.closeTo(0.3, 6) });
    expect(widestGap({ x: -0.1, y: -0.1, w: 1.2, h: 1.2 })).toBeNull();
  });
});

describe("what the strip says before Send", () => {
  const d = (kind: "comment" | "markup" | "erase", target: string, note: string) => ({ kind, target, note });
  it("picture changes are the ones that use a picture", () => {
    expect(isPicturePin(d("comment", "picture", ""))).toBe(true);
    expect(isPicturePin(d("markup", "picture", ""))).toBe(true);
    expect(isPicturePin(d("erase", "picture", ""))).toBe(true);
    expect(isPicturePin(d("comment", "headline", ""))).toBe(false);
    expect(needsNote(d("erase", "picture", ""))).toBe(false);
    expect(needsNote(d("markup", "picture", ""))).toBe(true);
  });
  it("counts changes and pictures; Send is ready only when every change that needs words has them", () => {
    const all = [d("comment", "picture", "a cup here"), d("comment", "headline", "shorter"), d("erase", "picture", ""), d("markup", "picture", "")];
    expect(draftSummary(all)).toEqual({ changes: 4, pictures: 3, missing: 1, ready: false });
    // The fewest and the most it can use, retries included (PI-30).
    expect(summaryLine(all)).toBe("4 changes · uses 3 to 8 pictures · 1 needs a comment");
    const ok = [d("comment", "headline", "shorter")];
    expect(draftSummary(ok).ready).toBe(true);
    expect(summaryLine(ok)).toBe("1 change");
    expect(summaryLine([])).toBe("");
    expect(draftSummary([]).ready).toBe(false);
  });
});
