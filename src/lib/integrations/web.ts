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

/** An IPv6 address as its 16 bytes (handles "::" and a trailing dotted IPv4), or null. */
function v6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const p = dotted.split(".").map(Number);
    s = s.slice(0, -dotted.length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [(n >> 8) & 0xff, n & 0xff];
  });
}

/**
 * True for anything that isn't a public internet address. IPv6 is judged on
 * its bytes, not its spelling: `new URL()` rewrites [::ffff:127.0.0.1] as
 * ::ffff:7f00:1, and IPv4 can hide inside IPv6 in several ways (mapped,
 * compatible, NAT64, 6to4), so each embedded IPv4 is checked by the IPv4
 * rules. Found by the 2026-11-17 break-it test, where the hex spellings of
 * 127.0.0.1 and the cloud metadata address 169.254.169.254 got through.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return v4Private(ip);
  if (v !== 6) return true;
  const b = v6Bytes(ip);
  if (!b) return true;
  const v4 = (i: number) => v4Private(b.slice(i, i + 4).join("."));
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4(12); // ::ffff:a.b.c.d (mapped)
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) return v4(12); // ::ffff:0:a.b.c.d (translated, RFC 6145)
  if (zero(0, 12)) return true; // ::, ::1 and the deprecated ::a.b.c.d (compatible)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true; // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
  if (b[0] === 0x20 && b[1] === 0x02) return v4(2); // 2002::/16 (6to4)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // 2001::/32 (Teredo)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 (documentation)
  if (b[0] === 0x01 && b[1] === 0x00 && zero(2, 8)) return true; // 100::/64 (discard)
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 (unique local)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 (link local)
  if (b[0] === 0xff) return true; // ff00::/8 (multicast)
  return false;
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

export const safeGet: Getter = async (raw) => {
  const r = await get(checkUrl(raw), 0, PAGE);
  return { url: r.url, contentType: r.contentType, body: r.body.toString("utf8").replace(/\u0000/g, "") };
};

/** What one kind of fetch accepts: its size cap, Accept header, and which content types pass. */
interface FetchRules {
  maxBytes: number;
  accept: string;
  /** Null when the type is fine; otherwise the message for the person. */
  refuseType: (type: string) => string | null;
  tooLarge: string;
}

// Only pages, feeds and text: a PDF or an image read as text broke the save
// with a database error (2026-11-17 test). No type at all is let through and
// judged by its content, as before.
const PAGE: FetchRules = {
  maxBytes: MAX_BYTES,
  accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/vtt,text/plain;q=0.9,*/*;q=0.5",
  refuseType: (type) =>
    type && !/^text\/|xml|json|javascript/.test(type)
      ? /pdf/.test(type) ? "That's a PDF. Open it, copy the text and paste it in instead." : "That address isn't a web page, so there's no writing to read."
      : null,
  tooLarge: "That page is too large to read.",
};

/** The biggest picture fetched from a link: the same cap as an upload (lib/data/assets). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE: FetchRules = {
  maxBytes: MAX_IMAGE_BYTES,
  accept: "image/png,image/jpeg,image/webp;q=0.9",
  refuseType: (type) => (/^image\/(png|jpe?g|webp)\b/.test(type) ? null : "That link isn't a PNG, JPG or WebP picture."),
  tooLarge: "That picture is over 5 MB. Save a smaller one and upload it instead.",
};

export interface FetchedBytes {
  url: string;
  contentType: string;
  body: Uint8Array;
}

/**
 * A picture from a link, behind the same guard as a page (public addresses
 * only, checked at connect time, three redirects, 10 seconds), PNG, JPEG or
 * WebP only by its content type, at most 5 MB. The caller still checks the
 * bytes themselves (lib/storage/sniff) before keeping anything.
 */
export const safeGetImage = async (raw: string): Promise<FetchedBytes> => {
  const r = await get(checkUrl(raw), 0, IMAGE);
  return { url: r.url, contentType: r.contentType, body: new Uint8Array(r.body) };
};

/**
 * A link that may be a page or a picture (a Pinterest pin, or an image
 * address): pages and PNG, JPEG or WebP pictures pass, at most 5 MB, behind
 * the same guard. The caller branches on the content type.
 */
const PAGE_OR_IMAGE: FetchRules = {
  maxBytes: MAX_IMAGE_BYTES,
  accept: "text/html,application/xhtml+xml,image/png,image/jpeg,image/webp;q=0.9,*/*;q=0.5",
  refuseType: (type) =>
    !type || /^text\/html|xhtml|^image\/(png|jpe?g|webp)\b/.test(type) ? null : "That link isn't a page or a PNG, JPG or WebP picture.",
  tooLarge: "That picture is over 5 MB. Save a smaller one and upload it instead.",
};

/** The rules each kind of fetch applies, for tests. */
export const FETCH_RULES = { page: PAGE, image: IMAGE, pageOrImage: PAGE_OR_IMAGE } as const;

export const safeGetLink = async (raw: string): Promise<FetchedBytes> => {
  const r = await get(checkUrl(raw), 0, PAGE_OR_IMAGE);
  return { url: r.url, contentType: r.contentType, body: new Uint8Array(r.body) };
};

function get(u: URL, hops: number, rules: FetchRules): Promise<{ url: string; contentType: string; body: Buffer }> {
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
          Accept: rules.accept,
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (hops >= 3) return reject(new WebImportError("That address redirects too many times."));
          try {
            return resolve(get(checkUrl(new URL(res.headers.location, u).toString()), hops + 1, rules));
          } catch (e) {
            return reject(e);
          }
        }
        if (status >= 400) {
          res.resume();
          return reject(new WebImportError(status === 404 ? "Nothing was found at that address." : `That site answered with an error (${status}).`));
        }
        const type = String(res.headers["content-type"] ?? "").toLowerCase();
        const refused = rules.refuseType(type);
        if (refused) {
          res.resume();
          return reject(new WebImportError(refused));
        }
        // A stated length over the cap is refused before a byte is read.
        if (Number(res.headers["content-length"]) > rules.maxBytes) {
          res.resume();
          return reject(new WebImportError(rules.tooLarge));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > rules.maxBytes) {
            req.destroy();
            reject(new WebImportError(rules.tooLarge));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ url: u.toString(), contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
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
