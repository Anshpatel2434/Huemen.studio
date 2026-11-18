/**
 * Small Visual board fixes (2026-11-18):
 *
 *   - the Layouts list and "Show me options" offer a carousel only for formats
 *     that have one (an X post has none), like the carousel surface itself
 *   - a profile banner looks different in each of the four post layouts, so
 *     "Show me options" never shows four identical banners
 *   - Type size is a Huemen slider (role="slider", keys and pointer), never a
 *     native range input, with the same values (80 to 140 in steps of 5)
 *   - icon buttons on the board are named by aria-label, with no native
 *     title tooltip, and the picture menu button says whether it is open
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { artboardsFor, clampScale, DEFAULT_TWEAKS, POST_LAYOUTS, scaleAt, scaleForKey, SCALE } from "@/lib/visual/design";
import { FORMATS, formatUsesCarousel } from "@/lib/content/formats";
import { PostImage, schemesFrom } from "@/app/w/[id]/p/[pid]/visual/visual-layouts";
import { BoardIconButton, ScaleSlider } from "@/app/w/[id]/p/[pid]/visual/visual-panels";

const DIR = join(process.cwd(), "src/app/w/[id]/p/[pid]/visual");
const source = (f: string) => readFileSync(join(DIR, f), "utf8");

describe("carousel rows only where the format has a carousel", () => {
  it("an X post has a post image and a quote card, no carousel", () => {
    expect(artboardsFor("x_post")).toEqual(["post", "quote"]);
  });
  it("a carousel format keeps all three", () => {
    expect(artboardsFor("ig_carousel")).toEqual(["post", "quote", "carousel"]);
  });
  it("agrees with formatUsesCarousel for every format", () => {
    for (const f of FORMATS) expect(artboardsFor(f.key).includes("carousel"), f.key).toBe(formatUsesCarousel(f.key));
  });
  it("the Layouts list and the options tabs are built from it", () => {
    const board = source("visual-board.tsx");
    expect(board).toContain("{artboardsFor(item.format).map((k) => {");
    expect(board).toContain("items={artboardsFor(item.format).map(");
    expect(board).not.toContain('(["post", "quote", "carousel"] as ArtboardKind[]).map((k) => ({ value: k');
  });
});

describe("banners differ by layout", () => {
  const s = schemesFrom(["#F6F1E9", "#1F4D3A", "#141414"])[0];
  const fonts = { display: "var(--font-sans)", accent: "var(--font-serif)" };
  const draw = (layout: (typeof POST_LAYOUTS)[number]["key"], picture: { url: string; mode: "live_text" } | null = null) =>
    renderToStaticMarkup(createElement(PostImage, { layout, w: 1584, h: 396, s, t: DEFAULT_TWEAKS, fonts, brand: "Acme", eyebrow: "Pricing", text: () => "Clarity beats charisma.", picture }));

  it("each of the four post layouts draws its own banner", () => {
    const html = POST_LAYOUTS.map((l) => draw(l.key));
    expect(new Set(html).size).toBe(4);
    POST_LAYOUTS.forEach((l, i) => expect(html[i]).toContain(`data-banner="${l.key}"`));
  });
  it("still four different ones with a picture on the banner", () => {
    const pic = { url: "/api/storage/x.png?token=t", mode: "live_text" as const };
    expect(new Set(POST_LAYOUTS.map((l) => draw(l.key, pic))).size).toBe(4);
  });
  it("every banner keeps the headline and the sign-off", () => {
    for (const l of POST_LAYOUTS) {
      const html = draw(l.key);
      expect(html, l.key).toContain('data-part="headline"');
      expect(html, l.key).toContain('data-part="logo"');
    }
  });
  it("Editorial carries its eyebrow and serif italic, as on the square post", () => {
    const html = draw("editorial");
    expect(html).toContain("Pricing");
    expect(html).toContain("font-style:italic");
  });
});

describe("Type size: a Huemen slider, same values", () => {
  it("80 to 140 in steps of 5", () => {
    expect(SCALE).toEqual({ min: 80, max: 140, step: 5 });
    expect(clampScale(112)).toBe(110);
    expect(clampScale(300)).toBe(140);
    expect(clampScale(10)).toBe(80);
    expect(clampScale(Number.NaN)).toBe(100);
  });
  it("keys move it like a native slider", () => {
    expect(scaleForKey(100, "ArrowRight")).toBe(105);
    expect(scaleForKey(100, "ArrowUp")).toBe(105);
    expect(scaleForKey(100, "ArrowLeft")).toBe(95);
    expect(scaleForKey(100, "PageUp")).toBe(110);
    expect(scaleForKey(100, "PageDown")).toBe(90);
    expect(scaleForKey(100, "Home")).toBe(80);
    expect(scaleForKey(100, "End")).toBe(140);
    expect(scaleForKey(140, "ArrowRight")).toBe(140);
    expect(scaleForKey(100, "a")).toBeNull();
  });
  it("a point on the track is a value", () => {
    expect(scaleAt(0)).toBe(80);
    expect(scaleAt(0.5)).toBe(110);
    expect(scaleAt(1)).toBe(140);
    expect(scaleAt(-2)).toBe(80);
  });
  it("renders as role=slider with its values, no native range input", () => {
    const html = renderToStaticMarkup(createElement(ScaleSlider, { value: 110, onChange: () => {} }));
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="Type size"');
    expect(html).toContain('aria-valuemin="80"');
    expect(html).toContain('aria-valuemax="140"');
    expect(html).toContain('aria-valuenow="110"');
    expect(html).toContain('aria-valuetext="110%"');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain("<input");
  });
  it("no native range input, select or browser dialog anywhere on the visual board", () => {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".tsx"))) {
      const src = source(f);
      expect(src, f).not.toMatch(/type=["']range["']/);
      expect(src, f).not.toMatch(/<select[\s>]/);
      expect(src, f).not.toMatch(/\b(window\.)?(alert|confirm|prompt)\(/);
    }
  });
});

describe("icon buttons on the board", () => {
  it("are named by aria-label, with no native title tooltip, and say when a menu is open", () => {
    const html = renderToStaticMarkup(createElement(BoardIconButton, { label: "Add a picture", expanded: true }, "x"));
    expect(html).toContain('aria-label="Add a picture"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("title=");
  });
  it("the board uses them, not the shared IconButton (which sets title)", () => {
    for (const f of ["visual-board.tsx", "visual-comments-ui.tsx", "visual-panels.tsx"]) {
      expect(source(f), f).not.toMatch(/<IconButton[\s>]/);
    }
  });
});
