/**
 * Colour schemes and paint (lib/visual/schemes). Pure.
 *
 *   - the palette is read as [ground, accent, ink, ...extras]: Scheme 1 is the
 *     brand's own ground, with a readable ink and the accent
 *   - every scheme, on every ground it can be drawn on (as is, flipped for the
 *     quote card, the inverse and tint backgrounds), keeps text and the
 *     sign-off at 4.5:1 and marks (bars, the quote mark) at 3:1
 *   - the palettes real workspaces hold (read from the database 2026-11-17)
 */
import { describe, it, expect } from "vitest";
import { SCHEME_ORDER, contrast, isNeutral, mix, paint, schemeIndex, schemesFrom, type Scheme } from "@/lib/visual/schemes";
import { DEFAULT_TWEAKS, type Tweaks } from "@/lib/visual/design";

/** What onboarding, the website reader and hand edits have actually stored. */
const STORED: Record<string, string[]> = {
  "no palette": [],
  "two colours": ["#F6F1E9", "#1F4D3A"],
  "third is a second accent": ["#F6F1E9", "#1F4D3A", "#2377D2", "#FFFFFF"],
  "third is white": ["#F6F1E9", "#1F4D3A", "#FFFFFF", "#2377D2"],
  "third is the ink": ["#F6F1E9", "#1F4D3A", "#141414", "#C9A227"],
  "website reader": ["#F6F4EE", "#2F6BFF", "#DD3516", "#000000", "#A0775A", "#3898EC", "#8C684F"],
  "dark ground": ["#000000", "#FFFFFF", "#F4F4F4"],
  "one colour": ["#1F4D3A"],
  "pale accent": ["#FFFFFF", "#FFF4B8", "#111111"],
  "mid-tone ground": ["#7A7A7A", "#FF3429", "#FFFFFF"],
};

const GROUNDS: { base: "normal" | "inverse"; background: Tweaks["background"] }[] = [
  { base: "normal", background: "scheme" }, { base: "inverse", background: "scheme" },
  { base: "normal", background: "inverse" }, { base: "inverse", background: "inverse" },
  { base: "normal", background: "tint" }, { base: "inverse", background: "tint" },
];

describe("schemes from a brand palette", () => {
  it("Scheme 1 is the brand's own ground with a readable ink and the brand's accent", () => {
    const [s1] = schemesFrom(["#F6F1E9", "#1F4D3A", "#141414", "#C9A227"]);
    expect(s1).toEqual({ name: "Scheme 1", bg: "#F6F1E9", fg: "#141414", accent: "#1F4D3A" });
  });

  it("a light-ground brand is no longer put on black, and its accent shows", () => {
    // Before: the THIRD colour was taken as the ground, so this brand's Scheme 1 was its red.
    const [s1, s2] = schemesFrom(STORED["website reader"]);
    expect(s1.bg).toBe("#F6F4EE");
    expect(s1.fg).toBe("#000000");
    expect(s1.accent).toBe("#2F6BFF");
    // The inverse: the ink as the ground, the ground as the ink, the same accent.
    expect(s2).toMatchObject({ bg: "#000000", fg: "#F6F4EE", accent: "#2F6BFF" });
  });

  it("an edited accent shows in Scheme 1 at once", () => {
    const before = schemesFrom(["#F6F1E9", "#1F4D3A", "#141414"])[0];
    const after = schemesFrom(["#F6F1E9", "#B4002D", "#141414"])[0];
    expect(before.accent).toBe("#1F4D3A");
    expect(after.accent).toBe("#B4002D");
    expect(after.bg).toBe(before.bg);
  });

  it("the third colour is the ink only when it reads on the ground", () => {
    expect(schemesFrom(["#F6F1E9", "#1F4D3A", "#FFFFFF", "#2377D2"])[0].fg).toBe("#0a0a0a");
    expect(schemesFrom(["#F6F1E9", "#1F4D3A", "#2377D2", "#FFFFFF"])[0].fg).toBe("#0a0a0a");
    expect(schemesFrom(["#F6F1E9", "#1F4D3A"])[0].fg).toBe("#0a0a0a");
    expect(schemesFrom(["#000000", "#FFFFFF", "#F4F4F4"])[0]).toMatchObject({ bg: "#000000", fg: "#F4F4F4", accent: "#FFFFFF" });
  });

  it("derives the others from the same three roles: inverse, accent ground, first extra", () => {
    const s = schemesFrom(["#F6F1E9", "#1F4D3A", "#141414", "#C9A227"]);
    expect(s.map((x) => x.bg)).toEqual(["#F6F1E9", "#141414", "#1F4D3A", "#C9A227"]);
    expect(s.map((x) => x.name)).toEqual(["Scheme 1", "Scheme 2", "Scheme 3", "Scheme 4"]);
    // On the accent ground the accent can't mark itself: another of the brand's colours does.
    expect(s[2].accent).not.toBe("#1F4D3A");
    expect(STORED["third is the ink"]).toContain(s[2].accent);
  });

  it("with no palette the house colours stand in, light first, as before", () => {
    const s = schemesFrom([]);
    expect(s[0]).toEqual({ name: "Scheme 1", bg: "#ffffff", fg: "#0a0a0a", accent: "#6b6b6b" });
    expect(s[1].bg).toBe("#0a0a0a");
  });

  it("never repeats a ground, never invents a colour, and ignores what isn't a colour", () => {
    for (const [name, palette] of Object.entries(STORED)) {
      const s = schemesFrom(palette);
      expect(s.length, name).toBeGreaterThanOrEqual(2);
      expect(new Set(s.map((x) => x.bg.toLowerCase())).size, name).toBe(s.length);
      const allowed = [...palette, "#ffffff", "#0a0a0a", "#6b6b6b", "#000000"].map((c) => c.toLowerCase());
      for (const x of s) for (const c of [x.bg, x.fg, x.accent]) expect(allowed, `${name} ${x.name} ${c}`).toContain(c.toLowerCase());
    }
    expect(schemesFrom(["red", "#F6F1E9", "", "#1F4D3A"])[0]).toMatchObject({ bg: "#F6F1E9", accent: "#1F4D3A" });
  });

  it("every scheme passes contrast for text and accent on its own ground", () => {
    for (const [name, palette] of Object.entries(STORED)) {
      for (const s of schemesFrom(palette)) {
        expect(contrast(s.fg, s.bg), `${name} ${s.name} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(s.accent, s.bg), `${name} ${s.name} accent`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("a scheme index saved before the new order", () => {
  it("the old default becomes the brand's own ground; a scheme someone picked keeps its ground", () => {
    // What the database held on 2026-11-17 (workspace, palette, stored index).
    // Demo Client picked the black scheme (old Scheme 2): still black, now Scheme 1.
    const demo = ["#000000", "#FFFFFF", "#F4F4F4"];
    expect(schemesFrom(demo)[schemeIndex(demo, 1, 1)].bg).toBe("#000000");
    // Arjun Rao Advisory picked the blue scheme (old Scheme 3): still blue.
    const arjun = STORED["website reader"];
    expect(schemesFrom(arjun)[schemeIndex(arjun, 2, 1)].bg).toBe("#2F6BFF");
    // Priya Mehta Studio was on the default, which put a cream brand on near-black: now its cream.
    const priya = STORED["third is the ink"];
    expect(schemesFrom(priya)[schemeIndex(priya, 0, 1)].bg).toBe("#F6F1E9");
    // Meera Iyer Advisory was on the default, which was its second accent, red: now its own ground.
    const meera = ["#F6F4EE", "#1F6FEB", "#DD3516", "#000000", "#A0775A", "#3898EC", "#8C684F"];
    expect(schemesFrom(meera)[schemeIndex(meera, 0, 1)].bg).toBe("#F6F4EE");
    // With no palette the order never changed.
    for (const i of [0, 1, 2]) expect(schemeIndex([], i, 1)).toBe(i);
  });

  it("an index saved in the new order is used as it is, and a missing one falls back to Scheme 1", () => {
    const p = STORED["third is the ink"];
    for (const i of [0, 1, 2, 3]) expect(schemeIndex(p, i, SCHEME_ORDER)).toBe(i);
    expect(schemeIndex(p, 9, SCHEME_ORDER)).toBe(0);
    expect(schemeIndex(p, 9, 1)).toBe(0);
    expect(schemeIndex(p, Number.NaN, 1)).toBe(0);
    // An old pick whose ground no scheme has any more: Scheme 1.
    expect(schemeIndex(["#F6F1E9", "#1F4D3A", "#2377D2", "#FFFFFF"], 3, 1)).toBe(0);
  });
});

describe("the colours an artboard is drawn in", () => {
  it("text, the sign-off and the marks read on every ground of every scheme", () => {
    for (const [name, palette] of Object.entries(STORED)) {
      for (const s of schemesFrom(palette)) {
        for (const g of GROUNDS) {
          for (const accent of ["subtle", "bold", "none"] as const) {
            const p = paint(s, { background: g.background, accent }, g.base);
            const at = `${name} ${s.name} ${g.base}/${g.background}/${accent}`;
            expect(contrast(p.fg, p.bg), `${at} text`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(p.sign, p.bg), `${at} sign-off`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(p.words, p.bg), `${at} words`).toBeGreaterThanOrEqual(3);
            expect(contrast(p.accent, p.bg), `${at} accent`).toBeGreaterThanOrEqual(3);
            if (accent === "none") expect(p.mark).toBe("transparent");
            else expect(contrast(p.mark, p.bg), `${at} mark`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it("the dark quote card keeps its quote mark and name: an accent that would vanish is drawn in the ink", () => {
    // Cream ground, dark green accent, near-black ink: the quote card is drawn flipped, on the ink.
    const s: Scheme = schemesFrom(["#F6F1E9", "#1F4D3A", "#141414"])[0];
    expect(contrast(s.accent, s.fg)).toBeLessThan(3); // dark green on near-black: invisible before
    const card = paint(s, DEFAULT_TWEAKS, "inverse");
    expect(card.bg).toBe("#141414");
    expect(card.mark).toBe("#F6F1E9");
    expect(card.sign).toBe("#F6F1E9");
    // On its own ground the accent is used as it is.
    const post = paint(s, DEFAULT_TWEAKS, "normal");
    expect(post.mark).toBe("#1F4D3A");
    expect(post.sign).toBe("#1F4D3A");
  });

  it("the Inverse background keeps the accent bar", () => {
    const s = schemesFrom(["#F6F1E9", "#1F4D3A", "#141414"])[0];
    const p = paint(s, { ...DEFAULT_TWEAKS, background: "inverse" }, "normal");
    expect(p.mark).not.toBe("transparent");
    expect(contrast(p.mark, p.bg)).toBeGreaterThanOrEqual(3);
  });

  it("a tint is a real colour, 16% of the accent on the ground", () => {
    const s: Scheme = { name: "S", bg: "#ffffff", fg: "#111111", accent: "#060E9F" };
    const p = paint(s, { ...DEFAULT_TWEAKS, background: "tint" }, "normal");
    expect(p.bg).toBe(mix("#ffffff", "#060E9F", 0.16));
    expect(p.bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("knows a neutral from a colour", () => {
    expect(["#000000", "#FFFFFF", "#F4F4F4", "#6b6b6b", "#0a0a0a"].every(isNeutral)).toBe(true);
    expect(["#1F4D3A", "#FF3429", "#C9A227", "#2F6BFF"].some(isNeutral)).toBe(false);
  });
});
