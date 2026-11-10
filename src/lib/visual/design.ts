/**
 * How one piece's visuals are designed: which template each artboard uses
 * (layout variants) and the live tweaks over them. Pure and client-safe; the
 * server stores it on the piece's `image_assets` rows (params), the Visual
 * canvas reads and redraws from it.
 *
 * Every field has a default and `parseDesign` never trusts what it reads, so
 * a row written before this existed, or a value an older build doesn't know,
 * draws the original design rather than breaking the canvas.
 */

export const POST_LAYOUTS = [
  { key: "statement", label: "Statement", about: "One line, room to breathe, a mark and the name." },
  { key: "split", label: "Split", about: "The line on top, a colour band carrying the name." },
  { key: "framed", label: "Framed", about: "A hairline frame around a centred line." },
  { key: "editorial", label: "Editorial", about: "Serif italic, an eyebrow and a rule, like a magazine pull." },
] as const;
export const QUOTE_LAYOUTS = [
  { key: "classic", label: "Classic", about: "A big quote mark, the line in italic." },
  { key: "centered", label: "Centred", about: "Everything on the centre line, a short rule above the name." },
  { key: "minimal", label: "Minimal", about: "No marks: a rule on the left and the words." },
] as const;
export const CAROUSEL_LAYOUTS = [
  { key: "standard", label: "Alternating", about: "Frames swap ground and ink, so a swipe feels like a turn." },
  { key: "numbered", label: "Numbered", about: "A big number on every frame, one ground throughout." },
  { key: "progress", label: "Progress", about: "A bar along the foot shows how far through the reader is." },
] as const;

export type PostLayout = (typeof POST_LAYOUTS)[number]["key"];
export type QuoteLayout = (typeof QUOTE_LAYOUTS)[number]["key"];
export type CarouselLayout = (typeof CAROUSEL_LAYOUTS)[number]["key"];
export type ArtboardKind = "post" | "quote" | "carousel";

export interface Tweaks {
  /** Type size against the template's own, 0.8 to 1.4. */
  scale: number;
  align: "left" | "center";
  /** How loud the accent colour is: off, the template's own marks, or carrying the words too. */
  accent: "none" | "subtle" | "bold";
  /** The ground: the scheme's, the scheme flipped, or a tint of the accent. */
  background: "scheme" | "inverse" | "tint";
}

export interface Design {
  layouts: { post: PostLayout; quote: QuoteLayout; carousel: CarouselLayout };
  tweaks: Tweaks;
}

export const DEFAULT_TWEAKS: Tweaks = { scale: 1, align: "left", accent: "subtle", background: "scheme" };
export const DEFAULT_DESIGN: Design = {
  layouts: { post: "statement", quote: "classic", carousel: "standard" },
  tweaks: DEFAULT_TWEAKS,
};

const oneOf = <T extends string>(v: unknown, keys: readonly { key: T }[], fallback: T): T =>
  keys.some((k) => k.key === v) ? (v as T) : fallback;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Read a stored design; anything missing or unknown falls back to the default. */
export function parseDesign(raw: unknown): Design {
  const o = (raw && typeof raw === "object" ? raw : {}) as { layouts?: Record<string, unknown>; tweaks?: Record<string, unknown> };
  const l = o.layouts ?? {};
  const t = o.tweaks ?? {};
  const scale = Number(t.scale);
  return {
    layouts: {
      post: oneOf(l.post, POST_LAYOUTS, DEFAULT_DESIGN.layouts.post),
      quote: oneOf(l.quote, QUOTE_LAYOUTS, DEFAULT_DESIGN.layouts.quote),
      carousel: oneOf(l.carousel, CAROUSEL_LAYOUTS, DEFAULT_DESIGN.layouts.carousel),
    },
    tweaks: {
      scale: Number.isFinite(scale) ? Math.min(1.4, Math.max(0.8, Math.round(scale * 20) / 20)) : DEFAULT_TWEAKS.scale,
      align: pick(t.align, ["left", "center"] as const, DEFAULT_TWEAKS.align),
      accent: pick(t.accent, ["none", "subtle", "bold"] as const, DEFAULT_TWEAKS.accent),
      background: pick(t.background, ["scheme", "inverse", "tint"] as const, DEFAULT_TWEAKS.background),
    },
  };
}

export const sameDesign = (a: Design, b: Design) => JSON.stringify(parseDesign(a)) === JSON.stringify(parseDesign(b));
