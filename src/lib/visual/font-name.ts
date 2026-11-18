/**
 * The family name, weight and style inside an uploaded font file, so the
 * visual page can register it under the right name (lib/visual/fonts).
 * Server-side (node:zlib for WOFF and WOFF2). Reads only the `name` and `OS/2`
 * tables; every offset is bounds-checked and any surprise gives "unknown"
 * (nulls), never an exception.
 *
 * Formats: TrueType and OpenType (sfnt), WOFF (zlib per table), WOFF2 (one
 * brotli stream; `name` and `OS/2` are never transformed). Decompression is
 * capped, so a crafted file can't expand without limit.
 */
import { brotliDecompressSync, inflateSync } from "node:zlib";

export interface FontInfo {
  family: string | null;
  weight: number | null;
  italic: boolean;
}

const NONE: FontInfo = { family: null, weight: null, italic: false };
const MAX_TABLE = 1 << 20; // a name or OS/2 table is a few KB
const MAX_WOFF2 = 32 << 20;

type Tables = Map<string, Uint8Array>;

const u16 = (b: Uint8Array, o: number) => (o + 2 <= b.length ? (b[o] << 8) | b[o + 1] : -1);
const u32 = (b: Uint8Array, o: number) => (o + 4 <= b.length ? ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3] : -1);
const tag = (b: Uint8Array, o: number) => (o + 4 <= b.length ? String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) : "");
const slice = (b: Uint8Array, o: number, n: number) => (o >= 0 && n >= 0 && o + n <= b.length ? b.subarray(o, o + n) : null);

const WANT = new Set(["name", "OS/2"]);

function sfntTables(b: Uint8Array): Tables {
  const out: Tables = new Map();
  const n = u16(b, 4);
  for (let i = 0; i < n && i < 512; i++) {
    const r = 12 + i * 16;
    const t = tag(b, r);
    if (!WANT.has(t)) continue;
    const s = slice(b, u32(b, r + 8), u32(b, r + 12));
    if (s && s.length <= MAX_TABLE) out.set(t, s);
  }
  return out;
}

function woffTables(b: Uint8Array): Tables {
  const out: Tables = new Map();
  const n = u16(b, 12);
  for (let i = 0; i < n && i < 512; i++) {
    const r = 44 + i * 20;
    const t = tag(b, r);
    if (!WANT.has(t)) continue;
    const comp = slice(b, u32(b, r + 4), u32(b, r + 8));
    const orig = u32(b, r + 12);
    if (!comp || orig < 0 || orig > MAX_TABLE) continue;
    const data = comp.length < orig ? new Uint8Array(inflateSync(comp, { maxOutputLength: orig })) : comp;
    out.set(t, data);
  }
  return out;
}

/** WOFF2's known-table index (spec §4.1): only the ones that matter here. */
const W2_KNOWN: Record<number, string> = { 5: "name", 6: "OS/2", 10: "glyf", 11: "loca" };

function base128(b: Uint8Array, at: { o: number }): number {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const c = b[at.o++];
    if (c === undefined || (i === 0 && c === 0x80)) return -1;
    v = v * 128 + (c & 0x7f);
    if (!(c & 0x80)) return v;
  }
  return -1;
}

function woff2Tables(b: Uint8Array): Tables {
  const out: Tables = new Map();
  const n = u16(b, 12);
  const compressed = u32(b, 20);
  if (tag(b, 4) === "ttcf") return out; // collections: not read
  const at = { o: 48 };
  const dir: { tag: string; length: number }[] = [];
  for (let i = 0; i < n && i < 512; i++) {
    const flags = b[at.o++];
    if (flags === undefined) return out;
    const idx = flags & 0x3f;
    let t: string;
    if (idx === 63) { t = tag(b, at.o); at.o += 4; } else t = W2_KNOWN[idx] ?? `#${idx}`;
    const orig = base128(b, at);
    if (orig < 0) return out;
    const version = (flags >> 6) & 3;
    const transformed = t === "glyf" || t === "loca" ? version === 0 : version !== 0;
    let length = orig;
    if (transformed) {
      length = base128(b, at);
      if (length < 0) return out;
    }
    dir.push({ tag: t, length });
  }
  const stream = slice(b, at.o, compressed);
  if (!stream) return out;
  const data = new Uint8Array(brotliDecompressSync(stream, { maxOutputLength: MAX_WOFF2 }));
  let o = 0;
  for (const d of dir) {
    if (WANT.has(d.tag) && d.length <= MAX_TABLE) {
      const s = slice(data, o, d.length);
      if (s) out.set(d.tag, s);
    }
    o += d.length;
  }
  return out;
}

const utf16 = (s: Uint8Array) => {
  let out = "";
  for (let i = 0; i + 1 < s.length; i += 2) out += String.fromCharCode((s[i] << 8) | s[i + 1]);
  return out;
};
const latin1 = (s: Uint8Array) => String.fromCharCode(...s);

/** The typographic family (name ID 16), else the family (ID 1); Windows English first. */
function familyOf(name: Uint8Array): string | null {
  const count = u16(name, 2);
  const strings = u16(name, 4);
  if (count < 0 || strings < 0) return null;
  type Hit = { id: number; rank: number; text: string };
  const hits: Hit[] = [];
  for (let i = 0; i < count && i < 2048; i++) {
    const r = 6 + i * 12;
    const platform = u16(name, r), encoding = u16(name, r + 2), lang = u16(name, r + 4), id = u16(name, r + 6);
    if (id !== 1 && id !== 16) continue;
    const s = slice(name, strings + u16(name, r + 10), u16(name, r + 8));
    if (!s) continue;
    let text: string | null = null;
    let rank = 9;
    if (platform === 3 && (encoding === 1 || encoding === 10)) { text = utf16(s); rank = lang === 0x409 ? 0 : 1; }
    else if (platform === 0) { text = utf16(s); rank = 2; }
    else if (platform === 1 && encoding === 0) { text = latin1(s); rank = 3; }
    if (text) hits.push({ id, rank, text: text.replace(/\0/g, "").trim() });
  }
  const best = hits.filter((h) => h.text).sort((a, b) => (b.id - a.id) || (a.rank - b.rank))[0];
  return best?.text ?? null;
}

/** What the file says about itself, or nulls. */
export function readFontInfo(bytes: Uint8Array): FontInfo {
  try {
    const sig = tag(bytes, 0);
    const tables =
      sig === "wOFF" ? woffTables(bytes)
      : sig === "wOF2" ? woff2Tables(bytes)
      : sig === "OTTO" || sig === "true" || u32(bytes, 0) === 0x00010000 ? sfntTables(bytes)
      : null;
    if (!tables) return NONE;
    const name = tables.get("name");
    const os2 = tables.get("OS/2");
    const weight = os2 ? u16(os2, 4) : -1;
    const sel = os2 ? u16(os2, 62) : -1;
    return {
      family: name ? familyOf(name) : null,
      weight: weight >= 1 && weight <= 1000 ? weight : null,
      italic: sel >= 0 && (sel & 1) === 1,
    };
  } catch {
    return NONE;
  }
}
