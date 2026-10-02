/**
 * Turning what the web gives us into plain writing. Pure and client-safe, so
 * the browser can read an uploaded caption file the same way the server reads
 * a podcast transcript.
 *
 *   htmlToText     an HTML fragment as readable text, quotes and scripts gone
 *   extractArticle the main text of a page: <article>, else <main>, else body,
 *                  without navigation, headers, footers or forms
 *   findFeedLink   the RSS/Atom feed a page advertises
 *   parseFeed      RSS 2.0 and Atom: items with their text, link, date and any
 *                  Podcasting 2.0 transcript link
 *   parseCaptions  WebVTT or SRT as running text, with YouTube's rolling
 *                  duplicate lines collapsed
 */

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&apos;": "'", "&quot;": '"', "&rsquo;": "’", "&lsquo;": "‘", "&rdquo;": "”", "&ldquo;": "“", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(style|script|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, "")
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d|section|article|tr)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const pick = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? null;

export function extractArticle(html: string): { title: string; text: string } {
  const title = htmlToText(pick(html, "title") ?? "").split(/\s[|–—-]\s/)[0].trim();
  const scope = pick(html, "article") ?? pick(html, "main") ?? pick(html, "body") ?? html;
  const text = htmlToText(scope.replace(/<(nav|header|footer|aside|form|button|menu)\b[\s\S]*?<\/\1>/gi, ""));
  return { title, text };
}

export function findFeedLink(html: string, base: string): string | null {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) {
      try {
        return new URL(decodeEntities(href), base).toString();
      } catch {
        /* a broken href is no feed */
      }
    }
  }
  return null;
}

export interface FeedItem {
  title: string;
  link: string | null;
  date: string | null;
  html: string;
  transcript: { url: string; type: string } | null;
}

const inner = (xml: string, tags: string[]) => {
  for (const t of tags) {
    const v = xml.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, "i"))?.[1];
    if (v && v.trim()) return v.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
  }
  return "";
};

export const looksLikeFeed = (body: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i.test(body);

export function parseFeed(xml: string): { title: string; items: FeedItem[] } {
  const channelTitle = htmlToText(inner(xml.replace(/<(item|entry)\b[\s\S]*$/i, ""), ["title"]));
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const items = blocks.map((b): FeedItem => {
    const atomLink = b.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? b.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1];
    const rssLink = inner(b, ["link"]);
    const t = b.match(/<podcast:transcript\b[^>]*>/i)?.[0];
    return {
      title: htmlToText(inner(b, ["title"])),
      link: (atomLink ?? rssLink) || null,
      date: inner(b, ["pubDate", "published", "updated", "dc:date"]) || null,
      html: inner(b, ["content:encoded", "content", "description", "summary"]),
      transcript: t
        ? { url: decodeEntities(t.match(/url=["']([^"']+)["']/i)?.[1] ?? ""), type: t.match(/type=["']([^"']+)["']/i)?.[1] ?? "text/plain" }
        : null,
    };
  });
  return { title: channelTitle, items };
}

const TIMING = /^\d{1,2}:?\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{1,2}:?\d{2}:\d{2}[.,]\d{3}/;

export function parseCaptions(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line0 of lines) {
    const line = line0.trim();
    if (/^WEBVTT/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line)) { skipping = true; continue; }
    if (!line) { skipping = false; continue; }
    if (skipping) continue;
    if (/^\d+$/.test(line) || TIMING.test(line) || /-->/.test(line)) continue;
    const text = decodeEntities(line.replace(/<[^>]+>/g, "")).trim();
    // Auto captions roll: each cue repeats the line before it.
    if (text && text !== out[out.length - 1]) out.push(text);
  }
  return out.join(" ").replace(/\s{2,}/g, " ").replace(/([.?!])\s+(?=[A-Z])/g, "$1\n").trim();
}

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
