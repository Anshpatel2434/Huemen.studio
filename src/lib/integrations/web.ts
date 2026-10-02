/**
 * Reading someone's own public writing from a link: their website, blog,
 * Substack, Medium, or a podcast feed with transcripts.
 *
 * The server fetches a URL a person typed, so this is where server-side
 * request forgery would live. The guard is at CONNECT time, not just a check
 * up front: every address a hostname resolves to is checked as the socket
 * opens (DNS rebinding can't slip a private address in after the check), IP
 * literals are checked directly, only http(s) on ports 80/443, at most three
 * redirects (each re-checked), 2 MB, 10 seconds.
 *
 * Server-only.
 */
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { extractArticle, findFeedLink, htmlToText, looksLikeFeed, parseCaptions, parseFeed, wordCount } from "./text";

export class WebImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebImportError";
  }
}

// ---- address rules -------------------------------------------------------------

function v4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

/** True for anything that isn't a public internet address. */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return v4Private(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return v4Private(mapped);
    return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true;
}

/** A URL we're willing to fetch at all: http(s), default ports, not an internal name. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new WebImportError("That isn't a web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new WebImportError("Only web addresses (http or https) can be read.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new WebImportError("That address uses an unusual port.");
  if (u.username || u.password) throw new WebImportError("Addresses with a login in them can't be read.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) ? isPrivateAddress(host) : /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
    throw new WebImportError("That address isn't on the public internet.");
  }
  return u;
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(new WebImportError("That address isn't on the public internet."), "", 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export interface Fetched {
  url: string;
  contentType: string;
  body: string;
}

export type Getter = (url: string) => Promise<Fetched>;

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

export const safeGet: Getter = (raw) => get(checkUrl(raw), 0);

function get(u: URL, hops: number): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      u,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "User-Agent": "HuemenStudio/1.0 (reads a person's own writing, with their consent)",
          Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/vtt,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (hops >= 3) return reject(new WebImportError("That address redirects too many times."));
          try {
            return resolve(get(checkUrl(new URL(res.headers.location, u).toString()), hops + 1));
          } catch (e) {
            return reject(e);
          }
        }
        if (status >= 400) {
          res.resume();
          return reject(new WebImportError(status === 404 ? "Nothing was found at that address." : `That site answered with an error (${status}).`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new WebImportError("That page is too large to read."));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ url: u.toString(), contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => reject(new WebImportError("The page stopped loading.")));
      },
    );
    req.on("timeout", () => req.destroy(new WebImportError("That site took too long to answer.")));
    req.on("error", (e) => reject(e instanceof WebImportError ? e : new WebImportError("Couldn't reach that site.")));
    req.end();
  });
}

// ---- reading writing from a link ------------------------------------------------------

export interface WebPiece {
  externalId: string;
  body: string;
  channel: string;
  publishedAt: string | null;
  title: string;
}

/** Where a platform keeps its feed, when the person pastes their profile page. */
export function feedFor(raw: string): string | null {
  const u = new URL(raw);
  if (/\.substack\.com$/i.test(u.hostname) && !u.pathname.startsWith("/feed")) return `${u.origin}/feed`;
  const medium = u.hostname === "medium.com" && u.pathname.match(/^\/(@[^/]+)/)?.[1];
  if (medium) return `https://medium.com/feed/${medium}`;
  if (/\.medium\.com$/i.test(u.hostname) && u.pathname === "/") return `${u.origin}/feed`;
  return null;
}

const MAX_ITEMS = 30;
const MAX_WORDS = 3000;
const MIN_WORDS = 40;
const cap = (t: string) => (wordCount(t) > MAX_WORDS ? t.split(/(\s+)/).slice(0, MAX_WORDS * 2).join("").trim() : t);
const iso = (d: string | null) => {
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * Everything readable at a link: a feed's posts (or a podcast's transcripts),
 * or the one article on a page. Returns what it found and, in plain words,
 * what it couldn't use.
 */
export async function importFromUrl(raw: string, getter: Getter = safeGet): Promise<{ pieces: WebPiece[]; note: string }> {
  const start = checkUrl(raw).toString();
  const known = feedFor(start);
  let page = await getter(known ?? start);
  if (!looksLikeFeed(page.body) && !/xml/i.test(page.contentType)) {
    const feed = findFeedLink(page.body, page.url);
    if (!feed) {
      const { title, text } = extractArticle(page.body);
      if (wordCount(text) < MIN_WORDS) return { pieces: [], note: "There wasn't enough writing on that page to learn from." };
      return { pieces: [{ externalId: `url:${page.url}`, body: cap(text), channel: "newsletter", publishedAt: null, title: title || page.url }], note: "Read 1 page." };
    }
    page = await getter(feed);
  }

  const { title: feedTitle, items } = parseFeed(page.body);
  const withTranscripts = items.filter((i) => i.transcript?.url);
  const pieces: WebPiece[] = [];

  if (withTranscripts.length) {
    // A podcast: their spoken voice, from the transcripts the feed links to.
    for (const it of withTranscripts.slice(0, 10)) {
      try {
        const t = await getter(it.transcript!.url);
        const text = /vtt|srt|subrip/i.test(it.transcript!.type) || /-->/.test(t.body) ? parseCaptions(t.body) : /html/i.test(it.transcript!.type) ? htmlToText(t.body) : t.body.trim();
        if (wordCount(text) >= MIN_WORDS) pieces.push({ externalId: `url:${it.link ?? it.transcript!.url}`, body: cap(text), channel: "spoken", publishedAt: iso(it.date), title: it.title });
      } catch {
        /* one missing transcript shouldn't stop the rest */
      }
    }
    return { pieces, note: `Read ${pieces.length} ${pieces.length === 1 ? "transcript" : "transcripts"} from ${feedTitle || "the podcast"}.` };
  }

  for (const it of items.slice(0, MAX_ITEMS)) {
    const text = htmlToText(it.html);
    if (wordCount(text) < MIN_WORDS) continue;
    pieces.push({ externalId: `url:${it.link ?? `${page.url}#${it.title}`}`, body: cap(text), channel: "newsletter", publishedAt: iso(it.date), title: it.title });
  }
  const audioOnly = items.length > 0 && pieces.length === 0;
  return {
    pieces,
    note: audioOnly
      ? "That feed has no written posts or transcripts. Upload a transcript instead."
      : `Read ${pieces.length} ${pieces.length === 1 ? "post" : "posts"} from ${feedTitle || "the feed"}.`,
  };
}
