/**
 * Pure helpers of the Visual step:
 *
 *   - lib/visual/slides: a piece's copy as carousel frames. Every body line
 *     lands on a frame (grouped when there are more lines than frames), the
 *     call to action keeps the last frame, and an edit on a frame writes back
 *     to exactly its lines.
 *   - lib/visual/export: file names carry the piece, and sizes list once.
 *   - lib/visual/pins: overlapping comment pins move aside.
 */
import { describe, it, expect } from "vitest";
import { MAX_BODY_FRAMES, patchForSlide, slidesOf } from "@/lib/visual/slides";
import { exportBase, exportSizes, fileSlug } from "@/lib/visual/export";
import { PIN_SIZE, placePins } from "@/lib/visual/pins";
import { FORMATS } from "@/lib/content/formats";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1}.`);

describe("carousel frames from a piece's copy", () => {
  it("a body of 9 lines fills the frames to the end instead of stopping at line 5", () => {
    const piece = { hook: "The hook", body: lines(9).join("\n"), cta: "Follow for more" };
    const s = slidesOf(piece);
    expect(s.length).toBe(1 + MAX_BODY_FRAMES + 1);
    expect(s[0]).toEqual({ text: "The hook", src: { kind: "hook" } });
    expect(s.at(-1)).toEqual({ text: "Follow for more", src: { kind: "cta" } });
    // Every line is on a frame, once, in order.
    const body = s.slice(1, -1).map((x) => x.text).join("\n");
    expect(body.split("\n")).toEqual(lines(9));
    expect(s.at(-2)!.text).toContain("Line 9.");
    // Spread evenly: no frame carries more than one line more than another.
    const counts = s.slice(1, -1).map((x) => x.text.split("\n").length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("one line per frame while they fit, and no frame for a missing call to action", () => {
    const s = slidesOf({ hook: "H", body: "One.\n\nTwo.\nThree.", cta: "" });
    expect(s.map((x) => x.text)).toEqual(["H", "One.", "Two.", "Three."]);
    expect(slidesOf({ hook: "H", body: "", cta: "" }).map((x) => x.text)).toEqual(["H"]);
    expect(slidesOf({ hook: "H", body: "\n\n  \n", cta: "Go" }).map((x) => x.text)).toEqual(["H", "Go"]);
  });

  it("nothing is dropped whatever the length", () => {
    for (const n of [1, 4, 5, 6, 7, 11, 23, 40]) {
      const body = lines(n).join(n % 2 ? "\n" : "\n\n");
      const s = slidesOf({ hook: "H", body, cta: "C" });
      expect(s.length).toBe(1 + Math.min(n, MAX_BODY_FRAMES) + 1);
      expect(s.slice(1, -1).flatMap((x) => x.text.split(/\n+/))).toEqual(lines(n));
    }
  });

  it("an edit on a grouped frame rewrites exactly its lines and keeps the spacing around them", () => {
    const piece = { hook: "H", body: lines(9).join("\n\n"), cta: "C" };
    const s = slidesOf(piece);
    // Frame 2 of the body carries lines 2 and 3 (9 lines over 5 frames: 1, 2-3, 4-5, 6-7, 8-9).
    expect(s[2].text).toBe("Line 2.\n\nLine 3.");
    const edited = patchForSlide(piece, s[2], "Two and three, said once.");
    expect(edited.body).toBe(["Line 1.", "Two and three, said once.", ...lines(9).slice(3)].join("\n\n"));
    // Emptying a frame drops its lines and one gap, not the neighbours.
    const dropped = patchForSlide(piece, s[2], "");
    expect(dropped.body).toBe(["Line 1.", ...lines(9).slice(3)].join("\n\n"));
    const last = patchForSlide(piece, s[5], "");
    expect(last.body).toBe(lines(7).join("\n\n"));
    // The hook and the call to action write to their own fields.
    expect(patchForSlide(piece, s[0], "New hook")).toEqual({ hook: "New hook" });
    expect(patchForSlide(piece, s.at(-1)!, "New cta")).toEqual({ cta: "New cta" });
  });
});

describe("export names and sizes", () => {
  const a = { id: "11111111-aaaa-4bbb-8ccc-000000000001", hook: "Copying kills founder brand uniqueness" };
  const b = { id: "22222222-aaaa-4bbb-8ccc-000000000002", hook: "Most advice about pricing is wrong." };
  const twin = { id: "33333333-aaaa-4bbb-8ccc-000000000003", hook: "Copying kills founder brand uniqueness!" };

  it("a file is named after the brand and the piece", () => {
    expect(exportBase("Alex Rivera", a, [a, b])).toBe("alex-rivera-copying-kills-founder-brand-uniq");
    expect(exportBase("Alex Rivera", b, [a, b])).toBe("alex-rivera-most-advice-about-pricing-is-wro");
    expect(exportBase("Alex Rivera", a, [a, b])).not.toBe(exportBase("Alex Rivera", b, [a, b]));
  });

  it("two pieces with the same hook get a short id each, so one never saves over the other", () => {
    const x = exportBase("Alex Rivera", a, [a, b, twin]);
    const y = exportBase("Alex Rivera", twin, [a, b, twin]);
    expect(x).toBe("alex-rivera-copying-kills-founder-brand-uniq-111111");
    expect(y).toBe("alex-rivera-copying-kills-founder-brand-uniq-333333");
    // The piece that doesn't clash keeps the plain name.
    expect(exportBase("Alex Rivera", b, [a, b, twin])).toBe("alex-rivera-most-advice-about-pricing-is-wro");
  });

  it("stays a safe file name for an empty or symbol-only hook", () => {
    expect(exportBase("", { id: "x", hook: "" }, [])).toBe("visual-visual");
    expect(exportBase("Ünï & Co.", { id: "x", hook: "¿¡!?" }, [])).toMatch(/^[a-z0-9-]+$/);
    expect(fileSlug("The Brand Professor")).toBe("the-brand-professor");
  });

  it("lists each export size once with every format that uses it", () => {
    const rows = exportSizes(FORMATS);
    expect(new Set(rows.map((r) => r.size)).size).toBe(rows.length);
    const portrait = rows.find((r) => r.size === "1080×1350")!;
    // Before: the list kept the LAST format per size, so 4:5 read "Threads post" only.
    expect(portrait.formats).toEqual(["LinkedIn post", "Instagram caption", "Instagram carousel", "Threads post"]);
    expect(rows.find((r) => r.size === "1584×396")!.formats).toEqual(["Bio or About"]);
    expect(rows.flatMap((r) => r.formats).sort()).toEqual(FORMATS.map((f) => f.label).sort());
  });
});

describe("comment pins", () => {
  const apart = (p: { left: number; top: number }, q: { left: number; top: number }) =>
    Math.abs(p.left - q.left) >= PIN_SIZE || Math.abs(p.top - q.top) >= PIN_SIZE;

  it("a pin sits on the top-left corner of its box when nothing is in the way", () => {
    const at = placePins([{ id: "a", left: 100, top: 60 }, { id: "b", left: 200, top: 300 }]);
    expect(at.a).toEqual({ left: 100 - PIN_SIZE / 2, top: 60 - PIN_SIZE / 2 });
    expect(at.b).toEqual({ left: 200 - PIN_SIZE / 2, top: 300 - PIN_SIZE / 2 });
  });

  it("pins on the same spot move aside so every number can be read and clicked", () => {
    const boxes = [
      { id: "1", left: 40, top: 200 }, { id: "2", left: 40, top: 200 }, { id: "3", left: 44, top: 206 },
      { id: "4", left: 38, top: 196 }, { id: "5", left: 70, top: 204 },
    ];
    const at = placePins(boxes);
    const ids = Object.keys(at);
    expect(ids.length).toBe(5);
    for (const x of ids) for (const y of ids) if (x < y) expect(apart(at[x], at[y]), `${x} and ${y}`).toBe(true);
    // The first keeps its corner; the rest stay on their own row, to its right.
    expect(at["1"]).toEqual({ left: 28, top: 188 });
    expect(at["2"].top).toBe(188);
    expect(at["2"].left).toBeGreaterThan(at["1"].left);
  });
});
