/**
 * Reading someone's website for onboarding: the home page, up to three of its
 * stylesheets and its About page, all through the SSRF-guarded getter
 * (./web). Returns the brand (lib/visual/core), the page's name and
 * description, and the readable text of both pages, capped, for the "what you
 * do" read (the site_profile task). Nothing here saves anything.
 */
import { safeGet, type Getter } from "./web";
import { extractArticle, htmlToText, wordCount } from "./text";
import { extractSiteBrand, orderPalette, pageMeta } from "@/lib/visual/core";

export interface SiteRead {
  url: string;
  title: string;
  description: string;
  /** Ground first, then the accent (lib/visual/core orderPalette). */
  palette: string[];
  fonts: string[];
  logo: string | null;
  /** True when the site's own background is dark. */
  dark: boolean;
  /** The About page that was read, if the home page links to one. */
  aboutUrl: string | null;
  /** The home and About pages as plain text, at most MAX_WORDS. */
  text: string;
}

const MAX_WORDS = 2500;
const ABOUT_PATH = /^\/(about|about-us|about-me|my-story|our-story|story|who-we-are|meet-\w+)\/?$/i;

/** The page's own link to an About page, on the same site. */
export function findAboutLink(html: string, base: string): string | null {
  const host = new URL(base).host;
  for (const [, href, label] of html.matchAll(/<a\b[^>]*\shref=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(href, base); } catch { continue; }
    if (u.host !== host || !/^https?:$/.test(u.protocol)) continue;
    const text = label.replace(/<[^>]+>/g, "").trim();
    if (ABOUT_PATH.test(u.pathname) || /^about( me| us)?$/i.test(text)) return u.toString();
  }
  return null;
}

/**
 * A page's readable text: its <article> or <main> (lib/integrations/text), or
 * the whole body when that is nearly empty. Some sites wrap one small card in
 * <article> and put everything else outside it.
 */
function mainText(html: string): string {
  const main = extractArticle(html).text;
  if (wordCount(main) >= 60) return main;
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const whole = htmlToText(body.replace(/<(nav|header|footer|form|script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " "));
  return wordCount(whole) > wordCount(main) ? whole : main;
}

const cap = (t: string, words: number) => (wordCount(t) > words ? t.split(/(\s+)/).slice(0, words * 2).join("").trim() : t);
const isDark = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.35;
};

export async function readSite(raw: string, get: Getter = safeGet): Promise<SiteRead> {
  const page = await get(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  const first = extractSiteBrand(page.body, [], page.url);
  const aboutUrl = findAboutLink(page.body, page.url);
  const [css, about] = await Promise.all([
    Promise.all(first.stylesheets.map((s) => get(s).then((r) => r.body).catch(() => ""))),
    aboutUrl ? get(aboutUrl).then((r) => r.body).catch(() => "") : Promise.resolve(""),
  ]);
  const brand = extractSiteBrand(page.body, css, page.url);
  const { title, description } = pageMeta(page.body);
  const home = mainText(page.body);
  const aboutText = about ? mainText(about) : "";
  // Bracketed headings: a "Label:" line would end the Text block a task input reads (lib/ai/tasks block()).
  const text = cap([`[Home page]\n${home}`, aboutText ? `[About page]\n${aboutText}` : ""].filter(Boolean).join("\n\n"), MAX_WORDS);
  return {
    url: page.url,
    title,
    description,
    palette: orderPalette(brand.palette, brand.ground),
    fonts: brand.fonts,
    logo: brand.logo,
    dark: !!brand.ground && isDark(brand.ground),
    aboutUrl: about ? aboutUrl : null,
    text,
  };
}
