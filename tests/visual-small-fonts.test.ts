/**
 * F20 (2026-11-18): the brand heading font is loaded on the visual page.
 *
 *   - the family name, weight and style are read from an uploaded TTF, WOFF
 *     and WOFF2 file (lib/visual/font-name), so the upload is registered under
 *     the brand's name
 *   - the plan picks an upload first, else Google, else nothing (lib/visual/fonts)
 *   - the @font-face rules only ever carry our own signed storage links
 *   - the look check says the font is loaded, and where from
 */
import { describe, it, expect } from "vitest";
import { brotliCompressSync, deflateSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFontInfo } from "@/lib/visual/font-name";
import { cssFamily, fontFaceCss, fontStack, googleFamily, googleFontsHref, planBrandFonts, type UploadedFont } from "@/lib/visual/fonts";
import { lookCheck } from "@/lib/visual/look-check";
import { BrandFonts } from "@/app/w/[id]/p/[pid]/visual/visual-panels";

// ---- tiny font files: a name table and an OS/2 table, nothing else -----------------------

const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const utf16 = (s: string) => [...s].flatMap((c) => be16(c.charCodeAt(0)));

function nameTable(names: Record<number, string>): Uint8Array {
  const entries = Object.entries(names).map(([id, text]) => ({ id: Number(id), bytes: utf16(text) }));
  const head = 6 + entries.length * 12;
  const recs: number[] = [];
  const strings: number[] = [];
  for (const e of entries) {
    recs.push(...be16(3), ...be16(1), ...be16(0x409), ...be16(e.id), ...be16(e.bytes.length), ...be16(strings.length));
    strings.push(...e.bytes);
  }
  return new Uint8Array([...be16(0), ...be16(entries.length), ...be16(head), ...recs, ...strings]);
}
function os2Table(weight: number, italic: boolean): Uint8Array {
  const t = new Uint8Array(78);
  t.set(be16(weight), 4);
  t.set(be16(italic ? 1 : 0x40), 62);
  return t;
}
const pad4 = (a: number[]) => { while (a.length % 4) a.push(0); return a; };

function ttf(tables: Record<string, Uint8Array>): Uint8Array {
  const tags = Object.keys(tables);
  const out: number[] = [...be32(0x00010000), ...be16(tags.length), 0, 0, 0, 0, 0, 0];
  const offset = 12 + tags.length * 16;
  const data: number[] = [];
  for (const t of tags) {
    out.push(...[...t].map((c) => c.charCodeAt(0)), ...be32(0), ...be32(offset + data.length), ...be32(tables[t].length));
    data.push(...tables[t]);
    pad4(data);
  }
  return new Uint8Array([...out, ...data]);
}
function woff(tables: Record<string, Uint8Array>): Uint8Array {
  const tags = Object.keys(tables);
  const dirEnd = 44 + tags.length * 20;
  const dir: number[] = [];
  const data: number[] = [];
  for (const t of tags) {
    // As the WOFF spec says: a table that doesn't get smaller is stored as it is.
    const z = [...deflateSync(tables[t])];
    const comp = z.length < tables[t].length ? z : [...tables[t]];
    dir.push(...[...t].map((c) => c.charCodeAt(0)), ...be32(dirEnd + data.length), ...be32(comp.length), ...be32(tables[t].length), ...be32(0));
    data.push(...comp);
    pad4(data);
  }
  const head = [..."wOFF"].map((c) => c.charCodeAt(0)).concat(be32(0x00010000), be32(0), be16(tags.length), be16(0));
  while (head.length < 44) head.push(0);
  return new Uint8Array([...head, ...dir, ...data]);
}
function woff2(tables: [string, Uint8Array][]): Uint8Array {
  const KNOWN: Record<string, number> = { cmap: 0, name: 5, "OS/2": 6 };
  const dir: number[] = [];
  const raw: number[] = [];
  for (const [t, bytes] of tables) {
    const idx = KNOWN[t];
    if (idx === undefined) dir.push(63, ...[...t].map((c) => c.charCodeAt(0)));
    else dir.push(idx);
    // UIntBase128 for the length
    const len = bytes.length;
    if (len >= 128) dir.push(0x80 | (len >> 7), len & 127);
    else dir.push(len);
    raw.push(...bytes);
  }
  const stream = [...brotliCompressSync(new Uint8Array(raw))];
  const head = [..."wOF2"].map((c) => c.charCodeAt(0)).concat(be32(0x00010000), be32(0), be16(tables.length), be16(0), be32(raw.length), be32(stream.length));
  while (head.length < 48) head.push(0);
  return new Uint8Array([...head, ...dir, ...stream]);
}

describe("reading an uploaded font's own name", () => {
  const tables = { name: nameTable({ 1: "Fraunces 72pt", 16: "Fraunces" }), "OS/2": os2Table(600, true) };

  it("reads a TrueType file: typographic family first, weight and italic from OS/2", () => {
    expect(readFontInfo(ttf(tables))).toEqual({ family: "Fraunces", weight: 600, italic: true });
  });
  it("reads a WOFF file (zlib per table, small tables stored as they are)", () => {
    expect(readFontInfo(woff({ name: nameTable({ 1: "Borna" }), "OS/2": os2Table(400, false) }))).toEqual({ family: "Borna", weight: 400, italic: false });
    // A long name table compresses, so it is read through zlib.
    const long = nameTable({ 1: "Borna", 16: "Borna", 4: "Borna Regular ".repeat(20) });
    expect(readFontInfo(woff({ name: long }))).toEqual({ family: "Borna", weight: null, italic: false });
  });
  it("reads a WOFF2 file (one brotli stream), past tables before it", () => {
    const f = woff2([["cmap", new Uint8Array(37)], ["zzzz", new Uint8Array(200)], ["name", nameTable({ 1: "Söhne" })], ["OS/2", os2Table(500, false)]]);
    expect(readFontInfo(f)).toEqual({ family: "Söhne", weight: 500, italic: false });
  });
  it("gives nulls, not an exception, for a file it can't read", () => {
    expect(readFontInfo(new Uint8Array([0, 1, 0, 0, 0, 9]))).toEqual({ family: null, weight: null, italic: false });
    expect(readFontInfo(new Uint8Array([...("wOF2".split("").map((c) => c.charCodeAt(0))), 1, 2, 3]))).toEqual({ family: null, weight: null, italic: false });
    expect(readFontInfo(new Uint8Array(0))).toEqual({ family: null, weight: null, italic: false });
  });
});

const link = (n: number) => `/api/storage/tenants/00000000-0000-0000-0000-00000000000a/assets/f${n}.woff2?token=1700000000000.abc${n}`;
const up = (family: string | null, n: number, extra: Partial<UploadedFont> = {}): UploadedFont => ({ family, weight: 400, italic: false, url: link(n), mime: "font/woff2", ...extra });

describe("which source loads each brand font", () => {
  it("an upload named like the brand font is used for it, under the brand's spelling", () => {
    const plan = planBrandFonts(["Borna", "Inter"], [up("BORNA", 1, { weight: 700 }), up("borna", 2)]);
    expect(plan.source).toEqual({ Borna: "upload", Inter: "google" });
    expect(plan.faces.map((f) => [f.family, f.weight])).toEqual([["Borna", 700], ["Borna", 400]]);
    expect(plan.google).toEqual(["Inter"]);
  });
  it("an upload beats Google for the same family", () => {
    const plan = planBrandFonts(["Fraunces"], [up("Fraunces", 1)]);
    expect(plan.source.Fraunces).toBe("upload");
    expect(plan.google).toEqual([]);
  });
  it("a known Google font with no upload loads from Google (any capitalisation)", () => {
    const plan = planBrandFonts(["fraunces", "Inter"], []);
    expect(plan.google).toEqual(["Fraunces", "Inter"]);
    expect(googleFontsHref(plan.google)).toBe("https://fonts.googleapis.com/css2?family=Fraunces&family=Inter&display=swap");
    expect(googleFamily("playfair display")).toBe("Playfair Display");
  });
  it("an upload with no readable name goes to the heading font nothing else loads", () => {
    const plan = planBrandFonts(["Borna", "Inter"], [up(null, 1)]);
    expect(plan.source).toEqual({ Borna: "upload", Inter: "google" });
    expect(plan.faces[0].family).toBe("Borna");
  });
  it("a font with no upload that Google doesn't know is loaded from nowhere", () => {
    expect(planBrandFonts(["Borna"], []).source).toEqual({ Borna: "none" });
  });
  it("a link that isn't our own signed storage link is never used", () => {
    const plan = planBrandFonts(["Borna"], [up("Borna", 1, { url: "https://evil.example/x.woff2" }), up("Borna", 2, { url: '/api/storage/a.woff2?token=x") ; } body{' })]);
    expect(plan.faces).toEqual([]);
    expect(plan.source.Borna).toBe("none");
  });
});

describe("the CSS the page carries", () => {
  it("an @font-face rule per uploaded file, with its format, weight and style", () => {
    const css = fontFaceCss(planBrandFonts(["Borna"], [up("Borna", 1, { weight: 600, italic: true })]).faces);
    expect(css).toBe(`@font-face{font-family:"Borna";src:url("${link(1)}") format("woff2");font-weight:600;font-style:italic;font-display:swap;}`);
  });
  it("a font name can't break out of its quotes", () => {
    expect(cssFamily('Evil"; } body { x: url(y) </style>')).toBe("Evil body x urly style");
    expect(fontStack('Fra"unces', "var(--font-sans)")).toBe('"Fraunces", var(--font-sans)');
    expect(fontStack(undefined, "var(--font-sans)")).toBe("var(--font-sans)");
  });
  it("BrandFonts renders the rules and Google's stylesheet (with CORS, for the PNG export)", () => {
    const html = renderToStaticMarkup(createElement(BrandFonts, { plan: planBrandFonts(["Borna", "Inter"], [up("Borna", 1)]) }));
    expect(html).toContain('@font-face{font-family:"Borna"');
    expect(html).toContain('href="https://fonts.googleapis.com/css2?family=Inter&amp;display=swap"');
    expect(html).toContain('crossorigin="anonymous"');
  });
});

describe("the look check, once the font is loaded", () => {
  const base = { palette: ["#F6F1E9", "#1F4D3A", "#141414"], fonts: ["Fraunces"], scheme: { bg: "#F6F1E9", fg: "#141414", accent: "#1F4D3A" }, tweaks: { scale: 1, background: "scheme" as const, accent: "subtle" as const }, headline: "Clarity beats charisma." };
  const texts = (r: ReturnType<typeof lookCheck>) => r.findings.map((f) => f.text).join(" | ");

  it("credits the font and says where it came from", () => {
    expect(texts(lookCheck({ ...base, fontRendering: true, fontSource: "upload" }))).toContain("Set in your font, Fraunces, loaded from your uploaded file.");
    expect(texts(lookCheck({ ...base, fontRendering: true, fontSource: "google" }))).toContain("Set in your font, Fraunces, loaded from Google Fonts.");
  });
  it("with no source, says how to fix it (upload the file)", () => {
    const t = texts(lookCheck({ ...base, fonts: ["Borna"], fontRendering: false, fontSource: "none" }));
    expect(t).toContain("Borna isn't loading here");
    expect(t).toContain("Upload its WOFF2, WOFF, TTF or OTF file");
  });
});
