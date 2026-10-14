/**
 * The Visual Core (Layer 1, M9): a brand's visual DNA beyond palette and fonts,
 * the brand read off its own website, and the token file a designer or another
 * tool can take away. Pure: no I/O, client-safe.
 */

export interface VisualCore {
  /** What each colour is for, keyed by hex (upper case): "Headlines and buttons". */
  roles?: Record<string, string>;
  /** Layout grid, in words: "Generous margins, one column, left-aligned text". */
  layout?: string;
  /** Motifs that recur: "Hand-drawn underline; a red dot before the headline". */
  motifs?: string;
  /** Photo and illustration style. */
  photoStyle?: string;
  /** Where it was read from, and the logo found there. */
  site?: { url: string; logo?: string | null; at: string };
  /** Reference designs ("this is our look"): asset ids, at most three. */
  references?: string[];
}

export const MAX_REFERENCES = 3;
const HEX6 = /^#[0-9a-f]{6}$/i;

export function cleanCore(c: VisualCore): VisualCore {
  const roles = Object.fromEntries(
    Object.entries(c.roles ?? {})
      .map(([k, v]) => [k.toUpperCase(), String(v ?? "").trim().slice(0, 120)] as const)
      .filter(([k, v]) => HEX6.test(k) && v),
  );
  const text = (s?: string) => (s ?? "").trim().slice(0, 600) || undefined;
  return {
    roles,
    layout: text(c.layout),
    motifs: text(c.motifs),
    photoStyle: text(c.photoStyle),
    site: c.site,
    references: [...new Set(c.references ?? [])].slice(0, MAX_REFERENCES),
  };
}

// ---- reading a brand off its website -------------------------------------------

export interface SiteBrand {
  palette: string[];
  fonts: string[];
  logo: string | null;
  /** The stylesheets worth reading, absolute, at most three. */
  stylesheets: string[];
}

const GENERIC_FONTS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "helvetica", "helvetica neue", "arial", "inherit", "initial",
  "apple color emoji", "segoe ui emoji", "noto color emoji", "var", "unset",
]);

const abs = (href: string, base: string): string | null => {
  try { return new URL(href, base).toString(); } catch { return null; }
};

/** Expand #abc to #AABBCC. */
const hex6 = (h: string) => (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h).toUpperCase();

/** Near-white, near-black and greys say little about a brand; keep one of each at most. */
function chroma(h: string): number {
  const n = parseInt(h.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * Pull a brand's colours, fonts and logo out of its home page and stylesheets.
 * Colours are ranked by how often they appear, a declared theme colour first;
 * greys are kept to two (a dark and a light) so the palette is the brand, not
 * the chrome. Fonts come from Google Fonts links and font-family declarations,
 * system stacks dropped.
 */
export function extractSiteBrand(html: string, css: string[], url: string): SiteBrand {
  const all = [html, ...css].join("\n");
  const count = new Map<string, number>();
  const theme = /<meta[^>]+name=["']theme-color["'][^>]*content=["'](#[0-9a-f]{3}(?:[0-9a-f]{3})?)["']/i.exec(html)?.[1];
  for (const m of all.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) {
    const h = hex6(m[0]);
    count.set(h, (count.get(h) ?? 0) + 1);
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const colourful = ranked.filter((h) => chroma(h) > 40);
  const greys = ranked.filter((h) => chroma(h) <= 40);
  const dark = greys.find((h) => parseInt(h.slice(1, 3), 16) < 60);
  const light = greys.find((h) => parseInt(h.slice(1, 3), 16) > 220);
  const palette = [...new Set([...(theme ? [hex6(theme)] : []), ...(dark ? [dark] : []), ...colourful.slice(0, 4), ...(light ? [light] : [])])].slice(0, 6);

  const fonts: string[] = [];
  const addFont = (f: string) => {
    const name = f.trim().replace(/^["']|["']$/g, "").replace(/\+/g, " ").trim();
    if (!name || name.length > 40 || /var\(|^\d/.test(name) || GENERIC_FONTS.has(name.toLowerCase())) return;
    if (!fonts.some((x) => x.toLowerCase() === name.toLowerCase())) fonts.push(name);
  };
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>\s]+)/gi)) {
    for (const fam of m[1].replace(/&amp;/g, "&").matchAll(/family=([^:&]+)/g)) addFont(decodeURIComponent(fam[1]));
  }
  for (const m of all.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) addFont(m[1].split(",")[0]);

  const logoCandidates = [
    ...[...html.matchAll(/<img[^>]+>/gi)].map((m) => m[0]).filter((t) => /logo/i.test(t)).map((t) => /src=["']([^"']+)["']/i.exec(t)?.[1]),
    /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1],
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1],
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1],
  ].filter((x): x is string => !!x && !x.startsWith("data:"));
  const logo = logoCandidates.length ? abs(logoCandidates[0], url) : null;

  const stylesheets = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1])
    .filter((h): h is string => !!h && !/fonts\.googleapis/.test(h))
    .map((h) => abs(h, url))
    .filter((h): h is string => !!h)
    .slice(0, 3);

  return { palette, fonts: fonts.slice(0, 4), logo, stylesheets };
}

// ---- the token file -------------------------------------------------------------

export interface VisualTokens {
  $schema: "huemen.visual-core/1";
  brand: string;
  color: { hex: string; role: string; use: string }[];
  font: { family: string; role: "heading" | "body" | "accent" }[];
  logo: string | null;
  layout: string | null;
  motifs: string | null;
  photoStyle: string | null;
  imageNotes: string | null;
  templates: { key: string; label: string; width: number; height: number }[];
}

/** The ground and accent are the first two colours by convention (visual-form). */
const DEFAULT_ROLE = ["ground", "accent"];

export const TEMPLATE_KIT = [
  { key: "post", label: "Post image", width: 1080, height: 1350 },
  { key: "quote", label: "Quote card", width: 1080, height: 1080 },
  { key: "carousel", label: "Carousel frame", width: 1080, height: 1350 },
  { key: "newsletter_header", label: "Newsletter header", width: 1200, height: 628 },
  { key: "banner", label: "Profile banner", width: 1584, height: 396 },
  { key: "thumbnail", label: "Video thumbnail", width: 1280, height: 720 },
] as const;

export function visualTokens(input: {
  brand: string;
  palette: string[];
  fonts: string[];
  imageStyleNotes: string;
  core: VisualCore;
}): VisualTokens {
  const roles = input.core.roles ?? {};
  return {
    $schema: "huemen.visual-core/1",
    brand: input.brand,
    color: input.palette.map((hex, i) => ({ hex: hex.toUpperCase(), role: DEFAULT_ROLE[i] ?? `colour-${i + 1}`, use: roles[hex.toUpperCase()] ?? "" })),
    font: input.fonts.map((family, i) => ({ family, role: i === 0 ? "heading" : i === 1 ? "body" : "accent" })),
    logo: input.core.site?.logo ?? null,
    layout: input.core.layout ?? null,
    motifs: input.core.motifs ?? null,
    photoStyle: input.core.photoStyle ?? null,
    imageNotes: input.imageStyleNotes || null,
    templates: TEMPLATE_KIT.map((t) => ({ ...t })),
  };
}

/** The visual core as plain prompt lines, for the one context builder. */
export function visualCoreLines(core: VisualCore | null | undefined): string[] {
  if (!core) return [];
  const out: string[] = [];
  const roles = Object.entries(core.roles ?? {});
  if (roles.length) out.push(`Colour use: ${roles.map(([h, r]) => `${h} for ${r}`).join("; ")}`);
  if (core.layout) out.push(`Layout: ${core.layout}`);
  if (core.motifs) out.push(`Motifs: ${core.motifs}`);
  if (core.photoStyle) out.push(`Photo and illustration style: ${core.photoStyle}`);
  return out;
}
