/**
 * Brand fonts on the visual canvas (F20, 2026-11-18). Pure and client-safe.
 *
 * The brand core names a heading and a body font ("Fraunces, Inter"). A name
 * is not a font on the page: something has to load it, or the visuals and the
 * PNG export fall back to the house sans and the look check says the font
 * isn't loading. Two sources, in this order:
 *
 *   1. A font file the person uploaded in Brand core (an asset of kind "font":
 *      WOFF2, WOFF, TTF or OTF). It is served from storage behind a short-lived
 *      signed link (/api/storage, tenant-prefixed key) and registered with an
 *      @font-face rule under the brand's own spelling of the name, so the
 *      canvas's `"Fraunces", var(--font-sans)` finds it. An upload whose
 *      embedded family name matches a brand font is used for that font; an
 *      upload with no readable name, or a name that matches none, is used for
 *      the first brand font that has no other source (heading first).
 *   2. Otherwise a known Google font, loaded in the browser from Google Fonts
 *      the way the style guide previews it (docs/decisions.md, "Self-hosted
 *      fonts": the house faces ship in the repo; brand previews load from
 *      Google at runtime). Nothing is stored.
 *
 * A font with neither source keeps the fallback chain (the house faces).
 *
 * The rules are CSS in a stylesheet, not FontFace objects, on purpose: the
 * PNG export (lib/ui/png, html-to-image) embeds the @font-face rules it finds
 * in the document's stylesheets, so the file is drawn in the same font.
 */

/** Families the visual page loads from Google Fonts when no file was uploaded. */
export const GOOGLE_FONTS: ReadonlySet<string> = new Set([
  // The style guide's pairs (components/style-guide.tsx).
  "Fraunces", "Inter", "Playfair Display", "Source Sans 3", "DM Serif Display", "DM Sans", "Space Grotesk",
  "Aleo", "Spectral", "Libre Baskerville", "Work Sans", "Syne", "Manrope", "Instrument Serif", "Archivo",
  // Families a brand site or a person commonly names.
  "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Raleway", "Nunito", "Nunito Sans", "Merriweather",
  "Lora", "PT Serif", "PT Sans", "Source Serif 4", "EB Garamond", "Cormorant Garamond", "Cormorant",
  "Bricolage Grotesque", "Outfit", "Plus Jakarta Sans", "Rubik", "Karla", "Mulish", "Oswald", "Bebas Neue",
  "Barlow", "Josefin Sans", "Crimson Pro", "Crimson Text", "Noto Sans", "Noto Serif", "Figtree", "Sora",
  "Epilogue", "Unbounded", "Instrument Sans", "Libre Franklin", "Cabin", "Quicksand", "Abril Fatface",
  "Archivo Black", "Anton", "Bitter", "Zilla Slab", "Roboto Slab", "Arvo", "Alegreya", "Newsreader",
  "Young Serif", "Gloock", "Hanken Grotesk", "Schibsted Grotesk", "Onest", "Geist", "IBM Plex Sans",
  "IBM Plex Serif", "IBM Plex Mono", "Red Hat Display", "Red Hat Text", "Lexend", "Urbanist", "Albert Sans",
  "Inter Tight", "Space Mono", "JetBrains Mono", "Prata", "Cinzel", "Marcellus", "Italiana", "Bodoni Moda",
  "Gelasio", "Domine", "Literata", "Petrona", "Besley", "Familjen Grotesk", "Darker Grotesque", "Chivo",
  "Public Sans", "Be Vietnam Pro", "Kumbh Sans", "League Spartan", "Jost", "Lexend Deca", "Manjari",
]);

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const GOOGLE_BY_NORM = new Map([...GOOGLE_FONTS].map((f) => [norm(f), f]));

/** The Google family a brand font name means ("playfair display" is "Playfair Display"), or null. */
export function googleFamily(name: string): string | null {
  return GOOGLE_BY_NORM.get(norm(name)) ?? null;
}

/**
 * A font name safe to put between double quotes in CSS (and in a style
 * attribute): letters, digits, spaces and a few marks. The canvas and the
 * @font-face rules both use this spelling, so they always agree.
 */
export function cssFamily(name: string): string {
  return name.replace(/[^\p{L}\p{N} \-_.&']/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** A font-family stack: the brand font first, then the fallback chain. */
export function fontStack(name: string | undefined, fallback: string): string {
  const f = name ? cssFamily(name) : "";
  return f ? `"${f}", ${fallback}` : fallback;
}

/** An uploaded font file, as the server reads it (lib/visual/brand-fonts). */
export interface UploadedFont {
  /** The family name inside the file (typographic family, else family), or null when it can't be read. */
  family: string | null;
  /** usWeightClass from the file's OS/2 table, or null. */
  weight: number | null;
  italic: boolean;
  /** Its short-lived signed link (same origin, /api/storage). */
  url: string;
  mime: string;
}

export interface FontFaceRule {
  family: string;
  url: string;
  format: "woff2" | "woff" | "truetype" | "opentype";
  weight: number | null;
  italic: boolean;
}

export type FontSource = "upload" | "google" | "none";

export interface FontPlan {
  /** @font-face rules for uploaded files, under the brand's spelling of each name. */
  faces: FontFaceRule[];
  /** Google families to load (the brand's fonts with no upload). */
  google: string[];
  /** Where each brand font (by its CSS spelling) comes from. */
  source: Record<string, FontSource>;
}

const FORMAT: Record<string, FontFaceRule["format"]> = {
  "font/woff2": "woff2", "font/woff": "woff", "application/font-woff": "woff", "font/ttf": "truetype", "font/otf": "opentype",
};
/** Only our own signed storage links go into a stylesheet. */
const SAFE_URL = /^\/api\/storage\/[A-Za-z0-9/._~%-]+\?token=[A-Za-z0-9._~%-]+$/;

/**
 * Which brand fonts come from an upload, which from Google, which from
 * nowhere. `brand` is the brand core's list (heading first); `uploads` is
 * newest first.
 */
export function planBrandFonts(brand: string[], uploads: UploadedFont[]): FontPlan {
  const names = [...new Set(brand.map(cssFamily).filter(Boolean))].slice(0, 2);
  const usable = uploads.filter((u) => FORMAT[u.mime] && SAFE_URL.test(u.url));
  const faces: FontFaceRule[] = [];
  const source: Record<string, FontSource> = {};
  const face = (family: string, u: UploadedFont): FontFaceRule => ({ family, url: u.url, format: FORMAT[u.mime], weight: u.weight, italic: u.italic });

  // 1. An upload whose own name is the brand font's name.
  const claimed = new Set<UploadedFont>();
  for (const n of names) {
    const mine = usable.filter((u) => u.family !== null && norm(u.family) === norm(n));
    if (!mine.length) continue;
    mine.forEach((u) => { claimed.add(u); faces.push(face(n, u)); });
    source[n] = "upload";
  }
  // 2. Uploads that name no brand font (or have no readable name), grouped by
  //    their own family, go to the brand fonts nothing else loads, heading first.
  const groups = new Map<string, UploadedFont[]>();
  usable.filter((u) => !claimed.has(u)).forEach((u, i) => {
    const k = u.family ? `f:${norm(u.family)}` : `n:${i}`;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  });
  const leftovers = [...groups.values()];
  for (const n of names) {
    if (source[n] || googleFamily(n)) continue;
    const group = leftovers.shift();
    if (!group) break;
    group.forEach((u) => faces.push(face(n, u)));
    source[n] = "upload";
  }
  // 3. Google for the rest it knows; nothing for the others (the fallback chain draws them).
  const google: string[] = [];
  for (const n of names) {
    if (source[n]) continue;
    const g = googleFamily(n);
    if (g) {
      google.push(g);
      source[n] = "google";
    } else source[n] = "none";
  }
  return { faces, google, source };
}

/** The @font-face rules for the plan's uploaded files. */
export function fontFaceCss(faces: FontFaceRule[]): string {
  return faces
    .filter((f) => SAFE_URL.test(f.url) && cssFamily(f.family) === f.family && f.family)
    .map((f) => {
      const weight = f.weight && f.weight >= 1 && f.weight <= 1000 ? `font-weight:${Math.round(f.weight)};` : "";
      return `@font-face{font-family:"${f.family}";src:url("${f.url}") format("${f.format}");${weight}font-style:${f.italic ? "italic" : "normal"};font-display:swap;}`;
    })
    .join("\n");
}

/**
 * The Google Fonts stylesheet for these families, built the way the style
 * guide builds it (regular weight; the browser does the rest), or null.
 */
export function googleFontsHref(families: string[]): string | null {
  const known = [...new Set(families.map((f) => googleFamily(f)).filter((f): f is string => !!f))];
  if (!known.length) return null;
  return `https://fonts.googleapis.com/css2?${known.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`).join("&")}&display=swap`;
}
