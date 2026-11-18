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
 *
 * And the picture tools' side of the board (2026-11-18):
 *
 *   - the canvas tool strip takes a board's tools generically (each with a key
 *     and the app's own tip, never title=); the tools' own file is held to the
 *     no-native-controls rule
 *   - a cut-out picture sits whole on the layout's own paint in every layout:
 *     contained, with no dark shade and the scheme's colours for the words
 *   - a picture version is named by how it came to be
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { artboardsFor, CAROUSEL_LAYOUTS, clampScale, DEFAULT_TWEAKS, POST_LAYOUTS, QUOTE_LAYOUTS, scaleAt, scaleForKey, SCALE } from "@/lib/visual/design";
import { FORMATS, formatUsesCarousel } from "@/lib/content/formats";
import { CarouselFrames, PostImage, QuoteCard, schemesFrom } from "@/app/w/[id]/p/[pid]/visual/visual-layouts";
import { BoardIconButton, ScaleSlider, versionLabel, WordsNote } from "@/app/w/[id]/p/[pid]/visual/visual-panels";
import { ToolBtn } from "@/components/canvas";

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
    const files = readdirSync(DIR).filter((x) => x.endsWith(".tsx"));
    // The picture tools (2026-11-18) are part of the board and held to the same rule.
    expect(files).toContain("picture-tools-ui.tsx");
    for (const f of files) {
      const src = source(f);
      expect(src, f).not.toMatch(/type=["']range["']/);
      expect(src, f).not.toMatch(/type=["'](date|time|datetime-local|color)["']/);
      expect(src, f).not.toMatch(/<select[\s>]/);
      expect(src, f).not.toMatch(/\b(window\.)?(alert|confirm|prompt)\(/);
    }
  });
  it("the picture tools draw their own controls: no native tooltip, no dialog of the browser's, no window.open", () => {
    const src = source("picture-tools-ui.tsx");
    // No title= on an HTML element (the Huemen Modal's `title` prop is its heading, not a tooltip).
    expect(src).not.toMatch(/<[a-z][\w-]*\b[^>]*\stitle=/);
    expect(src).not.toMatch(/window\.open\(/);
    expect(src).not.toMatch(/<IconButton[\s>]/);
    // Resize's zoom is the board's own slider.
    expect(src).toContain("<RangeSlider");
  });
});

describe("the canvas tool strip", () => {
  const canvas = readFileSync(join(process.cwd(), "src/components/canvas.tsx"), "utf8");
  it("has no native title tooltip: tools are named by aria-label and the app's own tip", () => {
    expect(canvas).not.toMatch(/title=/);
    expect(canvas).toContain("data-tip={name}");
    expect(canvas).toContain("aria-label={name}");
  });
  it("takes a board's tools generically, and no longer a comment switch", () => {
    expect(canvas).toContain("tools?: CanvasTools");
    expect(canvas).not.toMatch(/comment\??:/);
    // The tool's line is a row inside the strip, never a floating hint.
    expect(canvas).toContain('className="hu-strip__line"');
  });
  it("draws a tool with its key in the tip, and a tool that is off as disabled with the reason", () => {
    const on = renderToStaticMarkup(createElement(ToolBtn, { label: "Comment (C)", on: true, onClick: () => {} }, "x"));
    expect(on).toContain('aria-label="Comment (C)"');
    expect(on).toContain('data-tip="Comment (C)"');
    expect(on).toContain('aria-pressed="true"');
    expect(on).not.toContain("aria-disabled");
    const off = renderToStaticMarkup(createElement(ToolBtn, { label: "Erase (E)", off: "Add a picture first", onClick: () => {} }, "x"));
    expect(off).toContain('aria-label="Erase (E). Add a picture first"');
    expect(off).toContain('data-tip="Erase (E). Add a picture first"');
    expect(off).toContain('aria-disabled="true"');
    expect(off).not.toContain("title=");
  });
  it("the board gives it Comment, Markup, Erase, Remove background and Resize, each with its key", () => {
    const board = source("visual-board.tsx");
    for (const [label, key] of [["Comment", "C"], ["Markup", "M"], ["Erase", "E"], ["Remove background", "B"], ["Resize", "R"]]) {
      expect(board, label).toContain(`label: "${label}", key: "${key}"`);
    }
    expect(board).toContain("tools={wire ? undefined : {");
  });
});

describe("a cut-out picture on a visual", () => {
  const s = schemesFrom(["#F6F1E9", "#1F4D3A", "#141414"])[0];
  const fonts = { display: "var(--font-sans)", accent: "var(--font-serif)" };
  const url = "/api/storage/cut.png?token=t";
  const text = () => "Clarity beats charisma.";
  const post = (layout: (typeof POST_LAYOUTS)[number]["key"], cutout: boolean, w = 1080, h = 1350) =>
    renderToStaticMarkup(createElement(PostImage, { layout, w, h, s, t: DEFAULT_TWEAKS, fonts, brand: "Acme", text, picture: { url, mode: "live_text" as const, cutout } }));
  const quote = (layout: (typeof QUOTE_LAYOUTS)[number]["key"], cutout: boolean) =>
    renderToStaticMarkup(createElement(QuoteCard, { layout, s, t: DEFAULT_TWEAKS, fonts, brand: "Acme", text, picture: { url, mode: "live_text" as const, cutout } }));
  const carousel = (layout: (typeof CAROUSEL_LAYOUTS)[number]["key"], cutout: boolean) =>
    renderToStaticMarkup(createElement(CarouselFrames, { layout, slides: ["One", "Two"], s, t: DEFAULT_TWEAKS, fonts, frameWidth: 170, text, cover: { url, mode: "live_text" as const, cutout } }));
  // The dark shade over a backdrop picture, and the black the frame is painted under it.
  const SHADE = /rgba\(0,0,0,0\.\d+\)/;
  const BLACK = /background:#000[;"]/;

  it("sits whole in every post layout, square and banner: contained, no shade, no black ground", () => {
    for (const l of POST_LAYOUTS) {
      for (const [w, h] of [[1080, 1350], [1584, 396]]) {
        const html = post(l.key, true, w, h);
        expect(html, `${l.key} ${w}`).toContain("object-contain");
        expect(html, `${l.key} ${w}`).not.toContain("object-cover");
        expect(html, `${l.key} ${w}`).not.toMatch(SHADE);
        expect(html, `${l.key} ${w}`).not.toMatch(BLACK);
        expect(html, `${l.key} ${w}`).toContain('data-part="picture"');
        expect(html, `${l.key} ${w}`).toContain('data-part="headline"');
      }
    }
  });
  it("in the banners that put the picture behind the words, a cut-out stands in its own column instead", () => {
    for (const key of ["statement", "framed"] as const) {
      const html = post(key, true, 1584, 396);
      expect(html, key).toContain("data-cutout-column");
      // The only picture is the one in the column: nothing full-frame behind the words.
      expect(html.match(/data-part="picture"/g), key).toHaveLength(1);
      expect(post(key, false, 1584, 396), key).not.toContain("data-cutout-column");
    }
  });
  it("the same in every quote layout and on a carousel cover", () => {
    for (const l of QUOTE_LAYOUTS) {
      const html = quote(l.key, true);
      expect(html, l.key).toContain("object-contain");
      expect(html, l.key).not.toMatch(SHADE);
      expect(html, l.key).not.toMatch(BLACK);
    }
    for (const l of CAROUSEL_LAYOUTS) {
      const html = carousel(l.key, true);
      expect(html, l.key).toContain("object-contain");
      expect(html, l.key).not.toMatch(SHADE);
      expect(html, l.key).not.toMatch(BLACK);
    }
  });
  it("keeps the scheme's own colours for the words (not white over a picture)", () => {
    const cut = post("statement", true);
    const backdrop = post("statement", false);
    expect(backdrop).toContain("color:#ffffff");
    expect(cut).not.toContain("color:#ffffff");
    expect(cut).toContain(`background:${s.bg}`);
  });
  it("an ordinary picture is unchanged: cropped to fill, shaded where words sit on it", () => {
    const html = post("statement", false);
    expect(html).toContain("object-cover");
    expect(html).not.toContain("object-contain");
    expect(html).toMatch(SHADE);
    expect(quote("classic", false)).toMatch(SHADE);
    expect(carousel("standard", false)).toMatch(SHADE);
  });
  it("a cut-out is never treated as a picture with the heading drawn in", () => {
    const html = renderToStaticMarkup(createElement(PostImage, { layout: "statement", w: 1080, h: 1350, s, t: DEFAULT_TWEAKS, fonts, brand: "Acme", text, picture: { url, mode: "with_text" as const, cutout: true } }));
    expect(html).toContain('data-part="headline"');
    expect(html).toContain("object-contain");
  });
});

describe("picture versions say how each came to be", () => {
  it("uses the picture tools' labels, and today's for versions from before them", () => {
    expect(versionLabel({ op: "cutout", parentId: "p", mode: "live_text" })).toBe("background removed");
    expect(versionLabel({ op: "resize", parentId: "p", mode: "live_text" })).toBe("resized");
    expect(versionLabel({ op: "erase", parentId: "p", mode: "live_text" })).toBe("erased");
    expect(versionLabel({ op: "markup", parentId: "p", mode: "live_text" })).toBe("markup change");
    expect(versionLabel({ op: "area", parentId: "p", mode: "live_text" })).toBe("area change");
    expect(versionLabel({ op: "draw", parentId: null, mode: "live_text" })).toBe("new picture");
    expect(versionLabel({ op: "draw", parentId: null, mode: "with_text" })).toBe("new, heading drawn in");
    // No `op` (drawn before the picture tools): what the strip said before.
    expect(versionLabel({ parentId: "p", mode: "live_text" })).toBe("area change");
    expect(versionLabel({ parentId: null, mode: "live_text" })).toBe("new picture");
    expect(versionLabel({ parentId: null, mode: "with_text" })).toBe("new, heading drawn in");
  });
  it("a cut-out is downloaded through a real link, not a new window", () => {
    const src = source("visual-comments-ui.tsx");
    expect(src).toContain("download={cutout.name}");
    expect(src).toContain("Download cut-out");
    expect(src).not.toMatch(/window\.open\(/);
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
    for (const f of ["visual-board.tsx", "visual-comments-ui.tsx", "visual-panels.tsx", "picture-tools-ui.tsx"]) {
      expect(source(f), f).not.toMatch(/<IconButton[\s>]/);
    }
  });
});

describe("a picture that may still show words (2026-11-19)", () => {
  it("is said plainly under the visual: a note, no button, no tooltip, no 'AI'", () => {
    const html = renderToStaticMarkup(createElement(WordsNote));
    expect(html).toContain('role="note"');
    expect(html).toContain("This picture may show some words. Use Erase to remove them.");
    expect(html).not.toMatch(/<button|title=|AI/);
  });
  it("the board shows it only for a live-text picture flagged by the check, not a cut-out, not while it is being changed", () => {
    const src = readFileSync(join(DIR, "visual-board.tsx"), "utf8");
    expect(src).toContain("pic(k)?.textLeft && !pic(k)?.cutout && !working(i, k) ? <WordsNote /> : null");
    expect(src).toContain("textLeft: !!info.textLeft");
  });
});
