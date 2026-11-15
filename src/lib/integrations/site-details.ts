/**
 * What a website says about the business, read by rules alone (no model):
 * its name and line, what it offers, the projects it shows, what clients say,
 * the logos it is proud of, and how to reach it. Every item notes the page it
 * came from, and nothing is made up: a field the site doesn't state is left
 * empty.
 *
 * Sources, strongest first: the site's own structured data (JSON-LD, which
 * most site builders write for search engines), its meta tags, then the page
 * structure (headings, quote blocks, sections named "Clients").
 *
 * Pure: pages in, details out. The crawl is ./crawl.
 */
import { parse, type HTMLElement } from "node-html-parser";
import type { PageKind, ReadPage } from "./crawl";

export interface SiteService { name: string; about: string; from: string }
export interface SiteProject { title: string; summary: string; client: string; result: string; image: string | null; url: string; from: string }
export interface SiteTestimonial { quote: string; author: string; role: string; from: string }
export interface SiteClient { name: string; logo: string | null; from: string }
export interface SiteSocial { network: string; url: string }

export interface SiteDetails {
  name: string;
  /** The home page's headline, when it reads as a line about them. */
  tagline: string;
  /** The home page's description (meta). */
  summary: string;
  /** The opening of the About page, a few paragraphs at most. */
  about: string;
  services: SiteService[];
  projects: SiteProject[];
  testimonials: SiteTestimonial[];
  clients: SiteClient[];
  contact: { emails: string[]; phones: string[]; address: string };
  socials: SiteSocial[];
  /** The pages read, in order, with what each was taken to be. */
  pages: { url: string; kind: PageKind; title: string }[];
  /** Pages that send almost no words and build themselves in the browser. */
  scriptOnly: number;
}

const LIMIT = { services: 12, projects: 12, testimonials: 12, clients: 24 };

// ---- small helpers -------------------------------------------------------------

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();
const words = (s: string) => clean(s).split(" ").filter(Boolean).length;
const clip = (s: string, n: number) => {
  const t = clean(s);
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), n * 0.6)).replace(/[\s,;:–—-]+$/, "")}…`;
};
const abs = (href: string | undefined, base: string): string | null => {
  if (!href || href.startsWith("data:")) return null;
  try { return new URL(href.trim(), base).toString(); } catch { return null; }
};
const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function dedupe<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = key(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const textOf = (el: HTMLElement | null | undefined) => clean(el ? el.structuredText : "");
/** Text with its block breaks kept as new lines. */
const linesOf = (el: HTMLElement | null | undefined) => (el ? el.structuredText : "").split("\n").map(clean).filter(Boolean);
const meta = (root: HTMLElement, key: string) =>
  clean(root.querySelector(`meta[property="${key}"]`)?.getAttribute("content") ?? root.querySelector(`meta[name="${key}"]`)?.getAttribute("content"));

/** A page parsed. Parsed again wherever parts are removed (contentOf), so the original stays whole. */
const parseHtml = (html: string) => parse(html, { blockTextElements: { script: true, style: true, pre: true } });

/** The page's content without menus, headers, footers, forms and cookie banners. Changes the tree it is given. */
function contentOf(root: HTMLElement): HTMLElement {
  const main = root.querySelector("main") ?? root.querySelector("body") ?? root;
  for (const el of main.querySelectorAll("nav, header, footer, form, script, style, noscript, svg, template, [role=navigation], [role=dialog], [aria-modal]")) el.remove();
  // Cookie and consent banners: by name (Cookiebot, OneTrust, Finsweet "fs-consent", plain "cookie-banner"), or by what they say.
  for (const el of main.querySelectorAll("[class], [id]")) {
    // Small ones only: a page wrapper named "cookies-accepted" must not take the whole page with it.
    if (/cookie|consent|gdpr|onetrust|cookiebot/i.test(`${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`) && words(el.textContent) < 150) el.remove();
  }
  for (const p of main.querySelectorAll("p")) if (/\b(cookies?|privacy policy)\b/i.test(textOf(p)) && words(textOf(p)) < 80) p.remove();
  return main;
}

const imgSrc = (img: HTMLElement | null | undefined, base: string) => {
  if (!img) return null;
  const srcset = img.getAttribute("srcset") ?? img.getAttribute("data-srcset");
  const fromSet = srcset?.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
  return abs(img.getAttribute("data-src") ?? img.getAttribute("data-lazy-src") ?? img.getAttribute("src") ?? fromSet, base);
};

// ---- JSON-LD -------------------------------------------------------------------

type Ld = Record<string, unknown>;

/** Every JSON-LD object on a page, @graph flattened. A broken block is skipped. */
export function jsonLd(root: HTMLElement): Ld[] {
  const out: Ld[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Ld;
      out.push(o);
      if (o["@graph"]) walk(o["@graph"]);
    }
  };
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(s.textContent.trim())); } catch { /* not JSON: skip */ }
  }
  return out;
}

const types = (o: Ld) => [o["@type"]].flat().map((t) => String(t ?? ""));
const str = (v: unknown): string => (typeof v === "string" ? clean(v) : v && typeof v === "object" && "name" in (v as Ld) ? str((v as Ld).name) : "");
const ORG = /^(Organization|Corporation|LocalBusiness|ProfessionalService|Person|Store|Restaurant|MedicalBusiness|LegalService|FinancialService|EducationalOrganization|NGO|.*Business|.*Agency)$/;

// ---- name, line, about ---------------------------------------------------------

/** The part of the page titles that repeats across pages ("Work | Rivera Studio", "About | Rivera Studio"). */
function nameFromTitles(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const t of titles) for (const part of new Set(t.split(/\s+[|–—·•:-]\s+/).map(clean).filter(Boolean))) counts.set(part, (counts.get(part) ?? 0) + 1);
  const best = [...counts].filter(([p, n]) => n >= 2 && words(p) <= 6 && !/^home$/i.test(p)).sort((a, b) => b[1] - a[1])[0];
  return best?.[0] ?? "";
}

// ---- services ------------------------------------------------------------------

const NOT_A_SERVICE = /^(our |my )?(services|what (we|i) do|offerings?)$|contact|get in touch|let'?s (talk|chat)|faq|frequently|testimonial|review|ready to|book (a|your)|subscribe|newsletter|follow|why (choose|us|me|work)|how (it|we|i) work|our (work|process|clients|story|team)|latest|blog|news|about|clients|portfolio|case stud|pricing|get started|start (a|your)|sign up|thank|copyright|menu|search|cart|^\W*$/i;

/**
 * Services on a services page: a row of headings that look alike (the same
 * tag under the same kind of parent, at least two), each short and not a
 * sentence. A page's section headings ("How a call works.") don't form such a
 * row, so they stay out. Each name's description is the text right after it.
 */
function servicesOn(content: HTMLElement, from: string): SiteService[] {
  const groups = new Map<string, HTMLElement[]>();
  for (const h of content.querySelectorAll("h2, h3, h4, h5")) {
    const name = textOf(h);
    if (words(name) < 1 || words(name) > 7 || name.length > 60 || NOT_A_SERVICE.test(name) || /[.?!:]$/.test(name)) continue;
    const parent = h.parentNode as HTMLElement | null;
    const key = `${h.tagName}|${parent?.tagName ?? ""}|${(parent?.getAttribute("class") ?? "").split(/\s+/)[0] ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const nameLike = (g: HTMLElement[]) => {
    const names = g.map(textOf);
    return names.every((n) => /^[\p{Lu}\d]/u.test(n)) && names.filter((n) => n.length < 5).length * 2 < names.length;
  };
  const rows = [...groups.values()].filter((g) => g.length >= 2 && nameLike(g)).sort((a, b) => b.length - a.length);
  const out: SiteService[] = [];
  for (const h of rows.slice(0, 2).flat()) {
    let about = "";
    let sib = h.nextElementSibling;
    for (let i = 0; sib && i < 3; i++, sib = sib.nextElementSibling) {
      if (/^H[1-5]$/.test(sib.tagName)) break;
      const t = textOf(sib);
      if (words(t) >= 6) { about = t; break; }
    }
    out.push({ name: textOf(h), about: clip(about, 220), from });
  }
  return out;
}

// ---- projects ------------------------------------------------------------------

const CLIENT_LABEL = /\b(?:client|brand|company|for)\s*[:\-–—]\s*([^\n|•·]{2,60}?)(?=\s{2,}|\s*(?:\n|$|services?\b|year\b|industry\b|role\b|scope\b|sector\b|location\b))/i;
const METRIC = /[$€£₹]?\d[\d,.]*\s?(?:%|x|×|k|m|bn|b|million|billion|crore|lakh)(?![\p{L}])\+?(?:\s+[\p{Lu}][\p{L}]*){0,2}/iu;
const RESULT = /[^.!?\n]{0,140}\b\d[\d,.]*\s?(?:%|x|×|percent|times|k\b|m\b|million|crore|lakh)[^.!?\n]{0,140}[.!?]?/i;

function projectPage(root: HTMLElement, page: ReadPage, siteName: string): SiteProject {
  const content = contentOf(parseHtml(page.html));
  const og = meta(root, "og:title");
  const h1 = textOf(root.querySelector("h1"));
  const strip = (t: string) => clean(t.split(/\s+[|–—·•]\s+/).filter((p) => clean(p).toLowerCase() !== siteName.toLowerCase())[0] ?? t);
  // The headline, unless it is just the site's own name (a logo set as h1).
  const own = (t: string) => !!siteName && (keyOf(t) === keyOf(siteName) || keyOf(siteName).startsWith(keyOf(t)));
  const title = clip([h1, strip(og), strip(textOf(root.querySelector("title")))].find((t) => t && !own(t)) || h1, 120);
  const paras = content.querySelectorAll("p").map(textOf).filter((t) => words(t) >= 12);
  const summary = clip(meta(root, "og:description") || meta(root, "description") || paras[0] || "", 260);
  // Client: a "Client: X" label, or a definition list / small heading pair.
  let client = "";
  const flat = content.querySelectorAll("p, li, div, span, dd, dt, h5, h6").map(textOf).filter((t) => t.length < 120);
  for (let i = 0; i < flat.length && !client; i++) {
    const m = CLIENT_LABEL.exec(flat[i]);
    if (m) client = clean(m[1]);
    else if (/^client$/i.test(flat[i]) && flat[i + 1] && words(flat[i + 1]) <= 6) client = flat[i + 1];
  }
  // A result: a short metric line ("$380M Raised"), or the sentence with a number in it. Rows of labels don't count.
  let result = "";
  for (const line of linesOf(content)) {
    const m = RESULT.exec(line);
    if (!m) continue;
    const ws = line.split(" ");
    const caps = ws.filter((w) => /^[\p{Lu}$€£₹\d]/u.test(w)).length / ws.length;
    if (ws.length <= 6) { result = line; break; }
    if (caps < 0.5) { result = clean(m[0]); break; }
    // A row of labels ("Services Provided … Post Project $4M Raised"): just the metric and its words.
    const metric = METRIC.exec(line);
    if (metric) { result = clean(metric[0]); break; }
  }
  const image = abs(meta(root, "og:image"), page.url) ?? imgSrc(content.querySelector("img"), page.url);
  return { title, summary, client: clip(client, 60), result: clip(result, 200), image, url: page.url, from: page.url };
}

/** Project cards on a work page: a link to a project page with a heading or an image inside. */
function projectCards(content: HTMLElement, page: ReadPage): SiteProject[] {
  const out: SiteProject[] = [];
  for (const a of content.querySelectorAll("a[href]")) {
    const url = abs(a.getAttribute("href"), page.url);
    if (!url || url.replace(/\/+$/, "") === page.url.replace(/\/+$/, "")) continue;
    const u = new URL(url);
    if (u.host !== new URL(page.url).host || u.pathname.split("/").filter(Boolean).length < 2) continue;
    const heading = textOf(a.querySelector("h2, h3, h4, h5, strong")) || textOf(a.parentNode?.querySelector?.("h2, h3, h4") as HTMLElement | null);
    const img = a.querySelector("img");
    const title = heading || clean(img?.getAttribute("alt")) || (words(textOf(a)) <= 8 ? textOf(a) : "");
    if (!title || /^(view|see|read|more|learn|explore|case study|view project|discover)\b/i.test(title)) continue;
    out.push({ title: clip(title, 120), summary: "", client: "", result: "", image: imgSrc(img, page.url), url: u.toString(), from: page.url });
  }
  return out;
}

// ---- testimonials --------------------------------------------------------------

const QUOTE_MARKS = /^[\s"“”'‘’«»]+|[\s"“”'‘’«»]+$/g;
const SAY = /testimonial|review|quote|feedback|kind-?words|client-?say/i;

const BLOCK = new Set(["P", "DIV", "LI", "UL", "OL", "SECTION", "ARTICLE", "BLOCKQUOTE", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE"]);
/** Elements holding text but no blocks of their own: the leaves of a card. */
const leaves = (el: HTMLElement) =>
  el.querySelectorAll("p, q, div, span, li, h3, h4, h5, h6, cite, small, strong, figcaption")
    .filter((x) => !x.childNodes.some((c) => BLOCK.has((c as HTMLElement).tagName ?? "")) && textOf(x));

/** Who said it: a named element (cite, a "name" class), else the first short lines of the card. */
function author(block: HTMLElement, quote: string): { author: string; role: string } {
  const short = (t: string) => t && words(t) <= 8 && t.length <= 80 && !quote.includes(t) && !/[“”"]/.test(t);
  const named = block.querySelector("cite, figcaption, [class*=name], [class*=author], footer");
  let lines = named ? linesOf(named) : [];
  if (!lines.length || !short(lines[0])) lines = leaves(block).map(textOf).filter(short);
  const first = (lines[0] ?? "").replace(/^[\s—–-]+/, "");
  if (!first) return { author: "", role: "" };
  const [who, ...rest] = first.split(/\s*[,|·•–—]\s*/);
  return { author: clip(who, 60), role: clip(rest.join(", ") || lines[1] || "", 80) };
}

function testimonialsOn(page: ReadPage): SiteTestimonial[] {
  const from = page.url;
  const content = contentOf(parseHtml(page.html));
  const out: SiteTestimonial[] = [];
  const push = (quote: string, a: { author: string; role: string }) => {
    const q = clean(quote).replace(QUOTE_MARKS, "");
    if (q.length < 30 || q.length > 4000 || words(q) < 6 || /→|read (the|more)|case study|cookie/i.test(q)) return;
    out.push({ quote: clip(q, 600), author: a.author, role: a.role, from });
  };
  for (const bq of content.querySelectorAll("blockquote")) {
    const holder = (bq.parentNode?.tagName === "FIGURE" ? bq.parentNode : bq) as HTMLElement;
    const copy = bq.clone() as HTMLElement;
    for (const c of copy.querySelectorAll("cite, footer, figcaption")) c.remove();
    push(textOf(copy), author(holder, textOf(copy)));
  }
  // Cards named testimonial/review/quote holding exactly one long text: that text, and who said it.
  const cards = content.querySelectorAll("[class], [id]").filter((el) => SAY.test(`${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`));
  for (const card of cards) {
    const long = leaves(card).map(textOf).filter((t) => words(t) >= 10);
    const distinct = [...new Set(long)];
    if (distinct.length !== 1) continue;
    push(distinct[0], author(card, distinct[0]));
  }
  return out;
}

// ---- client logos --------------------------------------------------------------

const CLIENTS_HEADING = /\b(clients?|trusted by|brands? (we|i)('ve| have)? worked with|worked with|partners?|featured (in|on)|as seen (in|on)|our customers|companies (we|i))\b/i;

function clientsOn(content: HTMLElement, page: ReadPage): SiteClient[] {
  const groups: HTMLElement[] = [];
  for (const h of content.querySelectorAll("h1, h2, h3, h4, h5, h6, p, span")) {
    const t = textOf(h);
    if (!t || words(t) > 10 || !CLIENTS_HEADING.test(t)) continue;
    // Climb until the section holds at least three images.
    let box: HTMLElement | null = h.parentNode as HTMLElement | null;
    for (let i = 0; box && i < 4 && box.querySelectorAll("img").length < 3; i++) box = box.parentNode as HTMLElement | null;
    if (box && box.querySelectorAll("img").length >= 3) groups.push(box);
  }
  for (const el of content.querySelectorAll("[class]")) {
    if (/\b[\w-]*(clients?-?logos?|logos?-?(grid|wall|strip|carousel|list|marquee|row|wrap)|client-?(grid|list|wall)|partners|brands-?(grid|list|row))[\w-]*\b/i.test(el.getAttribute("class") ?? "") && el.querySelectorAll("img").length >= 3) groups.push(el);
  }
  // A row of logos: mostly SVG/PNG files, or images that say "logo" somewhere. Photo grids are not.
  const logoish = (img: HTMLElement) => /\.(svg|png)(\?|$)|logo/i.test(`${img.getAttribute("src") ?? ""} ${img.getAttribute("data-src") ?? ""} ${img.getAttribute("alt") ?? ""} ${img.getAttribute("class") ?? ""}`);
  const out: SiteClient[] = [];
  for (const g of groups) {
    const imgs = g.querySelectorAll("img");
    if (imgs.filter(logoish).length * 10 < imgs.length * 6) continue;
    for (const img of g.querySelectorAll("img")) {
      const alt = clean(img.getAttribute("alt") ?? img.getAttribute("title")).replace(/\b(logo|logotype|icon|image|client)\b/gi, "").replace(/[\s_-]+$/, "").trim();
      const logo = imgSrc(img, page.url);
      const fromFile = !alt && logo ? decodeURIComponent(new URL(logo).pathname.split("/").pop() ?? "").replace(/\.\w+$/, "").replace(/[-_]?(logo|white|black|dark|light|color|colour|\d+x\d+|@\dx|\d{2,})\b/gi, "").replace(/[-_]+/g, " ").trim() : "";
      const name = alt || fromFile;
      if (!name || words(name) > 4 || /[0-9a-f]{10,}|\b(arrow|chevron|icon|sticker|badge|star|play|close|menu|avatar|photo|portrait|headshot|profile)\b/i.test(name)) continue;
      out.push({ name: clip(name, 60), logo, from: page.url });
    }
  }
  return out;
}

// ---- contact and socials -------------------------------------------------------

const NETWORKS: [string, RegExp][] = [
  ["LinkedIn", /(^|\.)linkedin\.com$/], ["Instagram", /(^|\.)instagram\.com$/], ["X", /(^|\.)(twitter|x)\.com$/],
  ["Facebook", /(^|\.)facebook\.com$/], ["YouTube", /(^|\.)youtube\.com$|^youtu\.be$/], ["TikTok", /(^|\.)tiktok\.com$/],
  ["Behance", /(^|\.)behance\.net$/], ["Dribbble", /(^|\.)dribbble\.com$/], ["Pinterest", /(^|\.)pinterest\./],
  ["Medium", /(^|\.)medium\.com$/], ["Substack", /\.substack\.com$/], ["GitHub", /(^|\.)github\.com$/], ["Threads", /(^|\.)threads\.net$/],
];
const SHARE = /share|sharer|intent|\/dialog\/|\/plugins\/|status\/\d|\/p\/[\w-]{6,}|\/watch\?|\/embed\//i;
const JUNK_EMAIL = /example\.|sentry|wixpress|@2x|\.(png|jpe?g|svg|webp|gif)$|^u00|noreply|no-reply/i;

// ---- the read ------------------------------------------------------------------

export function extractDetails(pages: ReadPage[], hint: { title?: string; description?: string } = {}): SiteDetails {
  const parsed = pages.map((p) => ({ page: p, root: parseHtml(p.html) }));
  const content = (p: ReadPage) => contentOf(parseHtml(p.html));
  const home = parsed.find((p) => p.page.kind === "home") ?? parsed[0];
  const ld = parsed.flatMap((p) => jsonLd(p.root).map((o) => ({ o, from: p.page.url })));
  const siteHost = home ? new URL(home.page.url).host.replace(/^www\./, "") : "";
  const sameSite = (o: Ld) => { try { return new URL(String(o.url ?? o["@id"] ?? "")).host.replace(/^www\./, "") === siteHost; } catch { return false; } };
  const orgs = ld.filter(({ o }) => types(o).some((t) => ORG.test(t)) && str(o.name)).map(({ o }) => o);
  const org = orgs.find(sameSite) ?? orgs[0];
  const website = ld.find(({ o }) => types(o).includes("WebSite") && str(o.name))?.o;

  const titles = parsed.map((p) => textOf(p.root.querySelector("title")));
  const name = clip((home ? meta(home.root, "og:site_name") : "") || str(website?.name) || str(orgs.find(sameSite)?.name) || nameFromTitles(titles) || str(org?.name) || hint.title || "", 80);

  const summary = clip((home && (meta(home.root, "og:description") || meta(home.root, "description"))) || str(org?.description) || hint.description || "", 300);
  const h1 = home ? textOf(content(home.page).querySelector("h1")) : "";
  const tagline = h1 && words(h1) >= 3 && words(h1) <= 24 && keyOf(h1) !== keyOf(name) ? clip(h1, 160) : clip(str(org?.slogan), 160);

  // About: the About page's opening paragraphs.
  const aboutPage = parsed.find((p) => p.page.kind === "about");
  const about = aboutPage
    ? clip(content(aboutPage.page).querySelectorAll("p").map(textOf).filter((t) => words(t) >= 15).slice(0, 3).join("\n\n"), 1200)
    : "";

  // Services: each service page's own heading, the services page's headings, and structured data.
  const services: SiteService[] = [];
  for (const { page, root } of parsed.filter((p) => p.page.kind === "service")) {
    const fromTitle = clean(textOf(root.querySelector("title")).split(/\s+[|–—·•]\s+/)[0]);
    const n = fromTitle && words(fromTitle) <= 6 && keyOf(fromTitle) !== keyOf(name) ? fromTitle : textOf(root.querySelector("h1"));
    if (n && words(n) <= 10) services.push({ name: clip(n, 70), about: clip(meta(root, "description") || meta(root, "og:description"), 220), from: page.url });
  }
  for (const { page } of parsed.filter((p) => p.page.kind === "services")) services.push(...servicesOn(content(page), page.url));
  for (const { o, from } of ld) {
    if (types(o).includes("Service") && str(o.name)) services.push({ name: clip(str(o.name), 70), about: clip(str(o.description), 220), from });
    const catalog = o.hasOfferCatalog as Ld | undefined;
    const items = [catalog?.itemListElement, o.makesOffer].flat().filter(Boolean) as Ld[];
    for (const it of items) {
      const n = str(it.itemOffered) || str(it.name);
      if (n) services.push({ name: clip(n, 70), about: clip(str(it.description) || str((it.itemOffered as Ld | undefined)?.description), 220), from });
    }
  }

  // Projects: project pages first (richest), then the cards on the work page for any not read.
  const projectPages = parsed.filter((p) => p.page.kind === "project").map(({ page, root }) => projectPage(root, page, name));
  const cards = parsed.filter((p) => p.page.kind === "work").flatMap(({ page }) => projectCards(content(page), page));
  const readUrls = new Set(projectPages.map((p) => p.url.replace(/\/+$/, "")));
  const projects = dedupe([...projectPages, ...cards.filter((c) => !readUrls.has(c.url.replace(/\/+$/, "")))], (p) => p.url.replace(/\/+$/, "")).filter((p) => p.title);

  // Testimonials: structured reviews, then quote blocks and testimonial cards on any page read.
  const testimonials: SiteTestimonial[] = [];
  for (const { o, from } of ld) {
    for (const r of [types(o).includes("Review") ? o : null, ...[o.review].flat()].filter(Boolean) as Ld[]) {
      const body = str(r.reviewBody) || str(r.description);
      if (body.length >= 30) testimonials.push({ quote: clip(body, 600), author: clip(str(r.author), 60), role: "", from });
    }
  }
  for (const { page } of parsed) testimonials.push(...testimonialsOn(page));

  const clients = parsed.flatMap(({ page }) => clientsOn(content(page), page));

  // The business's own name (or the person's) is never one of its clients.
  const nameParts = name.split(/[,|:–—]/).map(keyOf).filter((k) => k.length > 2);
  const ownName = (n: string) => { const k = keyOf(n).replace(/ \d+$/, ""); return nameParts.some((p) => p.includes(k) || k.includes(p)); };

  // Contact: mailto/tel links on any page, the contact page's text, and structured data.
  const emails: string[] = [];
  const phones: string[] = [];
  const socials: SiteSocial[] = [];
  for (const { page, root } of parsed) {
    for (const a of root.querySelectorAll("a[href]")) {
      const href = clean(a.getAttribute("href"));
      if (/^mailto:/i.test(href)) emails.push(decodeURIComponent(href.slice(7).split("?")[0]).toLowerCase());
      else if (/^tel:/i.test(href)) phones.push(decodeURIComponent(href.slice(4)).replace(/[^\d+()\s-]/g, "").trim());
      else {
        const u = abs(href, page.url);
        if (!u) continue;
        const url = new URL(u);
        const net = NETWORKS.find(([, re]) => re.test(url.hostname.replace(/^www\./, "")))?.[0];
        if (net && !SHARE.test(url.pathname + url.search) && url.pathname.length > 1) socials.push({ network: net, url: `${url.origin}${url.pathname.replace(/\/+$/, "")}` });
      }
    }
    if (page.kind === "contact") {
      const body = parseHtml(page.html);
      for (const junk of body.querySelectorAll("script, style, noscript, template")) junk.remove();
      for (const m of linesOf(body).join("\n").matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,8}\b/gi)) emails.push(m[0].toLowerCase());
    }
  }
  for (const { o } of ld) {
    for (const s of [o.sameAs].flat()) {
      if (typeof s !== "string") continue;
      try {
        const url = new URL(s);
        const net = NETWORKS.find(([, re]) => re.test(url.hostname.replace(/^www\./, "")))?.[0];
        if (net) socials.push({ network: net, url: `${url.origin}${url.pathname.replace(/\/+$/, "")}` });
      } catch { /* not a URL */ }
    }
    if (typeof o.email === "string") emails.push(o.email.replace(/^mailto:/i, "").toLowerCase());
    if (typeof o.telephone === "string") phones.push(clean(o.telephone));
  }
  const addr = (org?.address ?? ld.find(({ o }) => o.address)?.o.address) as Ld | string | undefined;
  const address = typeof addr === "string"
    ? clean(addr)
    : addr ? [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, str(addr.addressCountry)].map((x) => (typeof x === "string" ? clean(x) : "")).filter(Boolean).join(", ") : "";

  return {
    name,
    tagline,
    summary,
    about,
    services: dedupe(services.filter((s) => s.name), (s) => keyOf(s.name)).slice(0, LIMIT.services),
    projects: projects.slice(0, LIMIT.projects),
    testimonials: dedupe(testimonials, (t) => keyOf(t.quote).slice(0, 60)).slice(0, LIMIT.testimonials),
    clients: dedupe(clients.filter((c) => !ownName(c.name)), (c) => keyOf(c.name).replace(/ \d+$/, "")).slice(0, LIMIT.clients),
    contact: {
      emails: dedupe(emails.filter((e) => /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(e) && !JUNK_EMAIL.test(e)), (e) => e).slice(0, 4),
      phones: dedupe(phones.filter((p) => p.replace(/\D/g, "").length >= 7), (p) => p.replace(/\D/g, "")).slice(0, 3),
      address: clip(address, 200),
    },
    socials: dedupe(socials, (s) => s.network).slice(0, 10),
    pages: parsed.map(({ page, root }) => ({ url: page.url, kind: page.kind, title: clip(textOf(root.querySelector("title")), 100) })),
    scriptOnly: 0,
  };
}

// ---- the profile the next screens offer ------------------------------------------

export interface SiteProfile { name: string; whatTheyDo: string; audience: string; offers: string; positioning: string }

const firstSentence = (t: string) => clean(/^[\s\S]*?[.!?](?=\s|$)/.exec(t)?.[0] ?? t);
const HELP = /\b(?:help|helps|helping|work with|works with|serve|serves|support|supports|partner with|partners with)\s+([^.!?\n]{3,120}?)(?=\s+(?:to|who|that|grow|build|get|find|achieve|turn|become|create|scale|launch|stand|win|sell)\b|[.!?,\n]|$)/i;
const FOR = /\bfor\s+((?:[\w-]+\s+){0,4}(?:founders|businesses|brands|companies|teams|leaders|coaches|consultants|startups|start-ups|professionals|creators|women|men|families|entrepreneurs|owners|executives|agencies|studios|experts|freelancers|marketers|small businesses))\b/i;

/**
 * Name, what they do, who it's for, what they offer and their line, from the
 * details alone, for the name and audience screens to offer. Empty where the
 * site doesn't say.
 */
export function profileFrom(d: SiteDetails): SiteProfile {
  const sources = [d.tagline, d.summary, d.about];
  let audience = "";
  for (const s of sources) {
    const m = [HELP.exec(s), FOR.exec(s)].find((x) => x && words(x[1]) <= 8 && !/^(you|your|people like you|us|them|as|our|the world)\b/i.test(x[1]));
    if (m) { audience = clean(m[1]); break; }
  }
  const whatTheyDo = clip(firstSentence(d.summary) || d.tagline || firstSentence(d.about), 160);
  return {
    name: d.name,
    whatTheyDo,
    audience: clip(audience, 200),
    offers: clip(d.services.map((s) => s.name).join(", "), 200),
    positioning: d.tagline && keyOf(d.tagline) !== keyOf(whatTheyDo) ? clip(d.tagline, 200) : "",
  };
}
