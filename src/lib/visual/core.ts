/**
 * The Visual Core (Layer 1, M9): a brand's visual DNA beyond palette and fonts,
 * the brand read off its own website, and the token file a designer or another
 * tool can take away. Pure: no I/O, client-safe.
 */
import { decodeEntities } from "@/lib/integrations/text";

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
  /** The page background the site declares (body, html or :root), if any. Dark on a dark site. */
  ground: string | null;
}

const GENERIC_FONTS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "helvetica", "helvetica neue", "arial", "inherit", "initial",
  "apple color emoji", "segoe ui emoji", "noto color emoji", "var", "unset",
]);
/** Icon fonts draw glyphs, not words: never a brand typeface. */
const ICON_FONT = /icon|awesome|glyph|symbols|dashicons|eicons|fontello|ionicons|feather|lucide|remixicon|bootstrap-icons/i;

const abs = (href: string, base: string): string | null => {
  try { return new URL(href, base).toString(); } catch { return null; }
};

/** Expand #abc to #AABBCC; #rrggbbaa and #rgba drop their alpha. */
const hex6 = (h: string) => {
  const s = h.length === 4 || h.length === 5 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h.slice(0, 7);
  return s.toUpperCase();
};
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** Near-white, near-black and greys say little about a brand; keep one of each at most. */
function chroma(h: string): number {
  const n = parseInt(h.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}
/** 0 (black) to 1 (white), perceived. */
function luminance(h: string): number {
  const n = parseInt(h.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const pct = (s: string, scale: number) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s));
const opaqueEnough = (a?: string) => a === undefined || pct(a, 1) >= 0.6;

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** OKLCH (CSS Color 4) to sRGB hex, the conversion browsers use. */
function oklchToHex(L: number, C: number, H: number): string {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255;
  return toHex(
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  );
}

const COLOUR = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/gi;

/** Every colour written in a CSS value: hex, rgb(), hsl() or oklch(), half-transparent ones skipped. */
export function coloursIn(value: string): string[] {
  const out: string[] = [];
  for (const [m] of value.matchAll(COLOUR)) {
    if (m.startsWith("#")) { out.push(hex6(m)); continue; }
    const args = m.slice(m.indexOf("(") + 1, -1).replace(/\//g, " / ").split(/[\s,]+/).filter((x) => x && x !== "/");
    const fn = m.slice(0, m.indexOf("(")).toLowerCase();
    if (args.length < 3 || args.slice(0, 3).some((x) => Number.isNaN(parseFloat(x)))) continue;
    if (!opaqueEnough(args[3])) continue;
    if (fn.startsWith("rgb")) out.push(toHex(pct(args[0], 255), pct(args[1], 255), pct(args[2], 255)));
    else if (fn.startsWith("hsl")) out.push(hslToHex(parseFloat(args[0]), pct(args[1], 100) / 100, pct(args[2], 100) / 100));
    else out.push(oklchToHex(pct(args[0], 1), pct(args[1], 0.4), parseFloat(args[2])));
  }
  return out;
}

/** CSS custom properties whose names say "this is the brand colour". */
const BRAND_VAR = /^--[\w-]*(brand|primary|accent|cta|highlight)[\w-]*$/i;
/** Selectors whose colours are the brand speaking: buttons, links, the big headings. */
const SPEAKING = /(^|[\s,>+~(])(button|a|h1|h2)(?=$|[\s,>+~:.[\])])|\.(btn|button|cta)\b/i;
const PAGE_GROUND = /(^|,)\s*(html|body|:root)\s*(,|$)/i;

/**
 * Pull a brand's colours, fonts and logo out of its home page and stylesheets.
 *
 * Colours are scored, not just counted: a declared theme colour comes first;
 * colours on buttons, links and big headings, and custom properties named
 * brand/primary/accent, count several times over; colours in gradients and
 * shadows (decoration) count for little. Hex, rgb(), hsl() and oklch() are all
 * read, and var(--x) is followed to the colour it names. Greys are kept to a
 * dark and a light, so the palette is the brand, not the chrome. The page's
 * own background is returned as `ground`, so a dark site is not given a white
 * ground.
 */
export function extractSiteBrand(html: string, css: string[], url: string): SiteBrand {
  const score = new Map<string, number>();
  const add = (h: string, w: number) => score.set(h, (score.get(h) ?? 0) + w);

  // CSS the page carries: stylesheets, <style> blocks, style="" attributes, and SVG fills (logos).
  const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const sheets = [...css, ...inlineCss].join("\n");
  for (const [, v] of html.matchAll(/\sstyle=["']([^"']*)["']/gi)) for (const c of coloursIn(v)) add(c, 1);
  for (const [, v] of html.matchAll(/\s(?:fill|stroke)=["']([^"']+)["']/gi)) for (const c of coloursIn(v)) add(c, 1);

  // Custom properties first, so var(--x) can be followed.
  const vars = new Map<string, string>();
  for (const [, name, value] of sheets.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) if (!vars.has(name)) vars.set(name, value.trim());
  const resolve = (value: string, depth = 0): string =>
    depth > 4 ? value : value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/g, (_, n: string, fb?: string) => resolve(vars.get(n) ?? fb ?? "", depth + 1));

  let ground: string | null = null;
  for (const [, selector, body] of sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = selector.trim();
    for (const [, prop, raw] of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
      const p = prop.toLowerCase();
      const value = resolve(raw);
      const colours = coloursIn(value);
      if (!colours.length) continue;
      let w = 1;
      if (p.startsWith("--")) w = BRAND_VAR.test(p) ? 6 : 1;
      else if (SPEAKING.test(sel) && /^(color|background|background-color|border-color|fill)$/.test(p)) w = 4;
      if (/gradient\(/i.test(value) || /shadow/.test(p)) w = 0.25;
      for (const c of colours) add(c, w);
      if (PAGE_GROUND.test(sel) && /^background(-color)?$/.test(p) && !/gradient\(/i.test(value)) ground = colours[0];
    }
  }

  const theme = /<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1];
  const themeHex = theme ? coloursIn(theme)[0] : undefined;
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const colourful = ranked.filter((h) => chroma(h) > 40);
  const greys = ranked.filter((h) => chroma(h) <= 40);
  const dark = greys.find((h) => luminance(h) < 0.24);
  const light = greys.find((h) => luminance(h) > 0.86);
  // A site that says it is dark (data-theme="dark", class="dark", color-scheme: dark) gets a dark ground
  // even when its CSS sets the background through theme-switching variables we can't follow.
  const saysDark = /<html\b[^>]*(?:data-theme|data-mode|data-color-scheme|class)\s*=\s*["'][^"']*\bdark\b/i.test(html)
    || /<meta[^>]+name=["']color-scheme["'][^>]*content=["']\s*dark/i.test(html);
  if (saysDark && (!ground || luminance(ground) > 0.5)) ground = (themeHex && luminance(themeHex) < 0.35 ? themeHex : null) ?? dark ?? ground;
  const palette = [...new Set([...(themeHex ? [themeHex] : []), ...(ground ? [ground] : []), ...(dark ? [dark] : []), ...colourful.slice(0, 4), ...(light ? [light] : [])])].slice(0, 6);

  const fonts: string[] = [];
  const addFont = (f: string) => {
    const name = f.replace(/!important/gi, "").trim().replace(/^["']|["']$/g, "").replace(/\+/g, " ").trim();
    if (!name || name.length > 40 || /var\(|^\d/.test(name) || GENERIC_FONTS.has(name.toLowerCase()) || ICON_FONT.test(name)) return;
    if (!fonts.some((x) => x.toLowerCase() === name.toLowerCase())) fonts.push(name);
  };
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>\s]+)/gi)) {
    for (const fam of m[1].replace(/&amp;/g, "&").matchAll(/family=([^:&]+)/g)) addFont(decodeURIComponent(fam[1]));
  }
  for (const m of [html, sheets].join("\n").matchAll(/font-family\s*:\s*([^;}{]+)/gi)) addFont(resolve(m[1]).split(",")[0]);

  // A logo the page shows beats an icon, and an icon beats the social share image (a banner, not a mark).
  const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find((x) => x !== undefined);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const linkHref = (rel: RegExp) => links.filter((t) => rel.test(attr(t, "rel") ?? "")).map((t) => attr(t, "href"));
  const icons = linkHref(/(^|\s)icon(\s|$)/i).sort((a, b) => Number(/\.(svg|png)(\?|$)/i.test(b ?? "")) - Number(/\.(svg|png)(\?|$)/i.test(a ?? "")));
  const logoCandidates = [
    ...[...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /logo/i.test(t)).map((t) => attr(t, "src")),
    ...linkHref(/apple-touch-icon/i),
    ...icons,
    ...[...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /^og:image$/i.test(attr(t, "property") ?? "")).map((t) => attr(t, "content")),
  ].filter((x): x is string => !!x && !x.startsWith("data:"));
  const logo = logoCandidates.length ? abs(logoCandidates[0], url) : null;

  const stylesheets = links
    .filter((t) => /(^|\s)stylesheet(\s|$)/i.test(attr(t, "rel") ?? ""))
    .map((t) => attr(t, "href"))
    .filter((h): h is string => !!h && !/fonts\.googleapis/.test(h))
    .map((h) => abs(h, url))
    .filter((h): h is string => !!h)
    .slice(0, 3);

  return { palette, fonts: fonts.slice(0, 4), logo, stylesheets, ground };
}

/**
 * A site's colours in the order a palette is read: the ground first (the page
 * background the site declares, else the lightest colour), then the accent
 * (the first real colour in the palette's own order, which is by how much the
 * site uses it; the most saturated only when there is no ranking to go on),
 * then the rest.
 */
export function orderPalette(palette: string[], ground: string | null = null): string[] {
  if (palette.length < 2) return palette;
  const g = ground && palette.includes(ground) ? ground : [...palette].sort((a, b) => luminance(b) - luminance(a))[0];
  const rest = palette.filter((c) => c !== g);
  const accent = rest.find((c) => chroma(c) > 40) ?? [...rest].sort((a, b) => chroma(b) - chroma(a))[0];
  return [g, accent, ...palette.filter((c) => c !== g && c !== accent)];
}

/**
 * The page's name and one-line description. Attribute values are read whole,
 * whichever quote wraps them, so "You don't" survives (a value in double
 * quotes may hold an apostrophe). "Jane Doe | Coaching" keeps the part that
 * names them; a bare "Home" is dropped.
 */
export function pageMeta(html: string): { title: string; description: string } {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const value = (tag: string, name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find((x) => x !== undefined) ?? "";
  const meta = (key: string) => {
    const tag = metas.find((t) => value(t, "name").toLowerCase() === key || value(t, "property").toLowerCase() === key);
    return tag ? value(tag, "content") : "";
  };
  const tidy = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  const title = tidy(meta("og:site_name") || titleTag).split(/\s[|–—-]\s/).filter((p) => !/^home$/i.test(p.trim()))[0]?.trim().slice(0, 80) ?? "";
  const description = tidy(meta("og:description") || meta("description")).slice(0, 240);
  return { title, description };
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
