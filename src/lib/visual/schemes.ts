/**
 * Colour schemes for the visuals, and the colours one artboard is drawn in.
 * Pure and client-safe.
 *
 * A stored palette is read as [ground, accent, ink, ...extras]: onboarding
 * (screen 5), the website reader (lib/visual/core orderPalette) and the token
 * file all write it that way. The third colour is only taken as the ink when
 * it reads on the ground (4.5:1); many palettes carry a second accent or a
 * white there, and then the darkest or lightest colour to hand is the ink.
 *
 *   Scheme 1   the brand's own ground, a readable ink, the accent
 *   Scheme 2   the same, flipped: ink as the ground
 *   Scheme 3   the accent as the ground
 *   Scheme 4   the first extra colour as the ground
 *
 * Every scheme keeps text at 4.5:1 and its accent at 3:1 on its ground, and
 * `paint` checks again on the ground actually drawn (a quote card is drawn
 * flipped, the background tweak flips or tints), so a mark, a quote mark or
 * the sign-off never disappears into the ground.
 */
import type { Tweaks } from "./design";

export type Scheme = { name: string; bg: string; fg: string; accent: string };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HOUSE_INK = "#0a0a0a";
const HOUSE_PAPER = "#ffffff";
/** With no palette the house tokens stand in: white ground, grey accent, near-black ink. */
const HOUSE = [HOUSE_PAPER, "#6b6b6b", HOUSE_INK];

function channels(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((x) => x + x).join("") : m.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours (1 when either isn't a hex colour). */
export function contrast(x: string, y: string): number {
  if (!HEX.test(x) || !HEX.test(y)) return 1;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** `a` with `share` of `b` mixed in (sRGB), as a hex colour. */
export function mix(a: string, b: string, share: number): string {
  if (!HEX.test(a) || !HEX.test(b)) return a;
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * share).toString(16).padStart(2, "0")).join("")}`;
}

/** Black, white and greys: colours any brand could be using. */
export function isNeutral(hex: string): boolean {
  if (!HEX.test(hex)) return true;
  const [r, g, b] = channels(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The colour text is set in on `bg`: the first preference that reads (4.5:1),
 * else the house ink or paper when one of them does, else whichever reads
 * best. Pure black is in the last resort because on a narrow band of
 * mid-tones neither the house ink nor white quite reaches 4.5:1, and one of
 * black and white always does.
 */
function inkOn(bg: string, prefer: string[]): string {
  const ok = [...prefer, HOUSE_INK, HOUSE_PAPER].find((c) => contrast(c, bg) >= 4.5);
  if (ok) return ok;
  return [...prefer, HOUSE_INK, HOUSE_PAPER, "#000000"].reduce((best, c) => (contrast(c, bg) > contrast(best, bg) ? c : best));
}

export function schemesFrom(palette: string[]): Scheme[] {
  const own = palette.filter((c) => HEX.test(c));
  const p = own.length ? own : HOUSE;
  const ground = p[0];
  const rest = p.slice(2);
  // The third colour is the ink when it reads on the ground; else the brand's
  // own darkest (or lightest) colour, when it has one that reads well (7:1).
  const ink = p[2] && contrast(p[2], ground) >= 4.5 ? p[2] : inkOn(ground, rest.filter((c) => contrast(c, ground) >= 7));
  const accent = p[1] ?? ink;
  const extras = rest.filter((c) => !same(c, ink) && !same(c, ground) && !same(c, accent));

  const out: Scheme[] = [];
  const add = (bg: string, inks: string[]) => {
    if (out.some((s) => same(s.bg, bg))) return;
    const fg = inkOn(bg, inks);
    // The accent of this scheme: the brand's, when it stands out on this ground;
    // else the next of the brand's own colours that does. Never a made-up colour.
    const seen = [accent, ...extras, ground, ink, HOUSE_PAPER, HOUSE_INK].filter((c) => !same(c, bg) && contrast(c, bg) >= 3);
    out.push({ name: `Scheme ${out.length + 1}`, bg, fg, accent: seen.find((c) => !same(c, fg)) ?? fg });
  };
  add(ground, [ink]);
  add(ink, [ground]);
  add(accent, [ground, ink]);
  if (extras[0]) add(extras[0], [ground, ink]);
  return out;
}

/**
 * A visual stores its scheme as an index into `schemesFrom`. The order of the
 * schemes changed when the palette began to be read as [ground, accent, ink]
 * (2026-11-17), so the order an index counts in is stamped beside it
 * (`schemeOrder` in the visual's params; missing means 1, the old order).
 */
export const SCHEME_ORDER = 2;

/**
 * The scheme a stored index means now.
 *
 * An index saved in the old order is carried over so nothing a person chose
 * changes under them: index 0 was the default nobody picked, and it becomes
 * Scheme 1, the brand's own ground (that is the fix); any other index keeps
 * the GROUND it was drawn on, wherever that scheme sits now. A ground that no
 * scheme has any more falls back to Scheme 1.
 */
export function schemeIndex(palette: string[], stored: number, order: number): number {
  const now = schemesFrom(palette);
  const at = Number.isFinite(stored) ? Math.max(0, Math.floor(stored)) : 0;
  if (order >= SCHEME_ORDER) return at < now.length ? at : 0;
  if (at === 0) return 0;
  // The old order: the third colour (or white), then the first, the second, the fourth.
  const own = palette.filter((c) => HEX.test(c));
  const [a, b, c, d] = own.length ? own : [HOUSE_INK, "#6b6b6b", HOUSE_PAPER];
  const light = c ?? HOUSE_PAPER;
  const grounds = [light, a, ...(b && !same(b, light) ? [b] : []), ...(d ? [d] : [])];
  const bg = grounds[at];
  const found = bg ? now.findIndex((s) => same(s.bg, bg)) : -1;
  return found >= 0 ? found : 0;
}

export type Paint = {
  bg: string;
  fg: string;
  /** The accent as drawn on this ground: the scheme's when it stands out (3:1), else the ink. */
  accent: string;
  /** Marks (bars, the quote mark): the accent, or nothing when the accent tweak is off. */
  mark: string;
  /** The sign-off: small text, so the accent only when it reads at 4.5:1. */
  sign: string;
  words: string;
  showMarks: boolean;
  bold: boolean;
};

/**
 * The colours one artboard is drawn in. `base` is the template's own ground
 * (a quote card is drawn inverse); the background tweak flips or tints it.
 * The accent tweak decides whether marks show and whether the words take the
 * accent too. Whatever the ground ends up as, a colour that would not show on
 * it is swapped for the ink.
 */
export function paint(s: Scheme, t: Pick<Tweaks, "background" | "accent">, base: "normal" | "inverse"): Paint {
  const inverse = (base === "inverse") !== (t.background === "inverse");
  const ground = inverse ? s.fg : s.bg;
  const ink = inverse ? s.bg : s.fg;
  const bg = t.background === "tint" ? mix(ground, s.accent, 0.16) : ground;
  const fg = contrast(ink, bg) >= 4.5 ? ink : inkOn(bg, [ink]);
  const seen = (min: number) => (contrast(s.accent, bg) >= min ? s.accent : fg);
  const showMarks = t.accent !== "none";
  return {
    bg,
    fg,
    accent: seen(3),
    mark: showMarks ? seen(3) : "transparent",
    sign: showMarks ? seen(4.5) : fg,
    words: t.accent === "bold" && contrast(s.accent, bg) >= 3 ? s.accent : fg,
    showMarks,
    bold: t.accent === "bold",
  };
}

/** Whichever of the scheme's colours (or black, white) reads best on a filled band of `bg`. */
export function onBand(s: Scheme, bg: string): string {
  return inkOn(bg, [s.bg, s.fg]);
}
