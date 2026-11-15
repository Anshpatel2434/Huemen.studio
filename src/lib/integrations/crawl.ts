/**
 * A small in-app crawler for someone's own website: no separate service, no
 * headless browser, no model. It plans which pages are worth reading (the
 * site's sitemap and its own links, minus what robots.txt asks us to leave),
 * then fetches them a few at a time through the SSRF-guarded getter (./web)
 * inside a time budget.
 *
 *   planCrawl   home page in, the pages to read out: home, about, services
 *               (and each service), work (and each project), testimonials,
 *               contact, team. At most MAX_PAGES.
 *   readPages   fetches a plan, HTML only, a few at a time, within a budget.
 *               A page that fails or runs past the budget is skipped, never fatal.
 *
 * Pure helpers (classify, parseRobots, robotsAllows, sitemapUrls, pickPages)
 * are exported for tests.
 */
import { safeGet, type Fetched, type Getter } from "./web";

export type PageKind = "home" | "about" | "services" | "service" | "work" | "project" | "testimonials" | "contact" | "team";

export interface PlannedPage {
  url: string;
  kind: PageKind;
}

export interface ReadPage extends PlannedPage {
  html: string;
}

export const MAX_PAGES = 16;
const MAX_SERVICES = 4;
const MAX_PROJECTS = 8;
const MAX_SITEMAP_URLS = 1500;

const SECTION: [Exclude<PageKind, "home" | "service" | "project">, RegExp][] = [
  ["about", /^(about|about-?us|about-?me|our-?story|my-?story|story|who-?we-?are|company|studio|agency|meet-[\w-]+|bio|profile)$/],
  ["services", /^(services?|what-?we-?do|what-?i-?do|offerings?|solutions?|capabilities|expertise|work-?with-?(me|us)|coaching|programs?|programmes?|packages|consulting|courses?)$/],
  ["work", /^(work|our-?work|portfolio|projects?|case-?stud(y|ies)|showcase|selected-?work|success-?stories|portfolio-?items?|clients)$/],
  ["testimonials", /^(testimonials?|reviews?|kind-?words|what-?(our-?)?clients-?say|results|love-?notes)$/],
  ["contact", /^(contact|contact-?us|contact-?me|get-?in-?touch|enquire|enquiry|inquire|book|book-?a-?call|lets-?talk)$/],
  ["team", /^(team|our-?team|people|meet-?the-?team)$/],
];

/** Link labels that name a section when the path doesn't ("Our work" → /selected). */
const SECTION_LABEL: [Exclude<PageKind, "home" | "service" | "project">, RegExp][] = [
  ["about", /^(about( (me|us))?|our story|my story|who we are)$/i],
  ["services", /^(services|what (we|i) do|offerings|work with (me|us)|solutions|capabilities)$/i],
  ["work", /^(work|our work|portfolio|projects|case studies|selected work|showcase|success stories)$/i],
  ["testimonials", /^(testimonials|reviews|kind words|what clients say)$/i],
  ["contact", /^(contact( (me|us))?|get in touch|let'?s talk|book a call|enquire)$/i],
  ["team", /^(team|our team|people)$/i],
];

/** Never worth reading for a brand: posts, shop, legal, account pages, files. */
const SKIP = /^(blog|news|posts?|articles?|insights|journal|tag|tags|category|categories|author|feed|wp-|cart|checkout|shop|store|products?|collections|account|login|signin|sign-in|register|privacy|terms|cookies?|legal|disclaimer|careers?|jobs|search|cdn-cgi|events?|podcast|episodes?)\b/i;
const FILE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp3|mp4|mov|xml|json|txt|css|js|ico|woff2?)$/i;

const segments = (u: URL) => u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase());

/** What a same-site URL is, from its path (and its link label as a hint). Null when it isn't worth reading. */
export function classify(u: URL, label = ""): PageKind | null {
  const segs = segments(u);
  if (segs.length === 0) return "home";
  if (FILE.test(u.pathname) || SKIP.test(segs[0])) return null;
  // Language prefixes: /en/about reads as /about.
  if (segs.length > 1 && /^[a-z]{2}(-[a-z]{2})?$/.test(segs[0])) segs.shift();
  const first = segs[0];
  const section = SECTION.find(([, re]) => re.test(first))?.[0];
  if (segs.length === 1) {
    if (section) return section;
    const byLabel = SECTION_LABEL.find(([, re]) => re.test(label.trim()))?.[0];
    return byLabel ?? null;
  }
  if (segs.length === 2 && section === "work") return "project";
  if (segs.length === 2 && section === "services") return "service";
  // WordPress portfolio plugins: /project/<slug>, /portfolio_page/<slug>.
  if (segs.length === 2 && /^(project|portfolio[-_]?(page|item)?|case-?study)$/.test(first)) return "project";
  return null;
}

// ---- robots.txt ----------------------------------------------------------------

export interface Robots {
  rules: { allow: boolean; path: string }[];
  sitemaps: string[];
}

/** The rules for "*" (or for us by name), and every Sitemap line. */
export function parseRobots(txt: string): Robots {
  const out: Robots = { rules: [], sitemaps: [] };
  let agents: string[] = [];
  let inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "sitemap") { if (value) out.sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (inRules) { agents = []; inRules = false; }
      agents.push(value.toLowerCase());
      continue;
    }
    if (key === "allow" || key === "disallow") {
      inRules = true;
      if (!agents.some((a) => a === "*" || a.includes("huemen"))) continue;
      if (key === "disallow" && !value) continue;
      out.rules.push({ allow: key === "allow", path: value });
    }
  }
  return out;
}

/** Longest matching rule wins; Allow wins a tie. Supports * and $. */
export function robotsAllows(robots: Robots, u: URL): boolean {
  const path = u.pathname + u.search;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of robots.rules) {
    const re = new RegExp(`^${r.path.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")}`);
    if (!re.test(path)) continue;
    if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

// ---- sitemaps ------------------------------------------------------------------

/** Every <loc> in a sitemap, and whether it is an index of other sitemaps. */
export function sitemapUrls(xml: string): { index: boolean; urls: string[] } {
  const index = /<sitemapindex\b/i.test(xml);
  const urls = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  return { index, urls };
}

async function readSitemaps(start: string[], get: Getter): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();
  let queue = start.slice(0, 3);
  for (let depth = 0; depth < 2 && queue.length; depth++) {
    const next: string[] = [];
    const bodies = await Promise.all(queue.map((u) => (seen.has(u) ? Promise.resolve(null) : (seen.add(u), get(u).then((r) => r.body).catch(() => null)))));
    for (const body of bodies) {
      if (!body) continue;
      const { index, urls } = sitemapUrls(body);
      if (index) {
        // Page, project and portfolio sitemaps first; posts, tags and products never.
        const useful = urls.filter((u) => !/post|blog|tag|categor|author|product|news|attachment|media/i.test(u));
        next.push(...useful.sort((a, b) => Number(/page|project|portfolio|work|case|service/i.test(b)) - Number(/page|project|portfolio|work|case|service/i.test(a))).slice(0, 3));
      } else {
        found.push(...urls);
      }
      if (found.length >= MAX_SITEMAP_URLS) return found.slice(0, MAX_SITEMAP_URLS);
    }
    queue = next;
  }
  return found;
}

// ---- links on the page ---------------------------------------------------------

/** Same-site links on a page, with their visible label. Navigation and footer links count most. */
export function pageLinks(html: string, base: string): { url: URL; label: string }[] {
  const host = new URL(base).host.replace(/^www\./, "");
  const out: { url: URL; label: string }[] = [];
  for (const [, href, label] of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(href.replace(/&amp;/g, "&"), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.host.replace(/^www\./, "") !== host) continue;
    out.push({ url: u, label: label.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  }
  return out;
}

const canonical = (u: URL) => `${u.origin}${u.pathname.replace(/\/+$/, "") || "/"}`;

/**
 * The pages to read, home first: the best page of each section (the shortest
 * path, a menu link over a sitemap entry), then each service and project page.
 */
export function pickPages(home: string, candidates: { url: URL; label: string; fromPage: boolean }[], robots: Robots): PlannedPage[] {
  const homeUrl = new URL(home);
  const picked: PlannedPage[] = [{ url: canonical(homeUrl), kind: "home" }];
  const seen = new Set([canonical(homeUrl)]);
  const sections = new Map<PageKind, { url: string; score: number }>();
  const services: string[] = [];
  const projects: string[] = [];
  for (const c of candidates) {
    if (c.url.host.replace(/^www\./, "") !== homeUrl.host.replace(/^www\./, "")) continue;
    const key = canonical(new URL(c.url.pathname, homeUrl.origin));
    if (seen.has(key) || !robotsAllows(robots, c.url)) continue;
    const kind = classify(c.url, c.label);
    if (!kind || kind === "home") continue;
    if (kind === "service" || kind === "project") {
      const list = kind === "service" ? services : projects;
      if (!list.includes(key)) list.push(key);
      continue;
    }
    const score = segments(c.url).join("/").length - (c.fromPage ? 100 : 0);
    const had = sections.get(kind);
    if (!had || score < had.score) sections.set(kind, { url: key, score });
  }
  for (const kind of ["about", "services", "work", "testimonials", "team", "contact"] as const) {
    const s = sections.get(kind);
    if (s && !seen.has(s.url)) { picked.push({ url: s.url, kind }); seen.add(s.url); }
  }
  for (const url of services.slice(0, MAX_SERVICES)) if (!seen.has(url)) { picked.push({ url, kind: "service" }); seen.add(url); }
  for (const url of projects.slice(0, MAX_PROJECTS)) if (!seen.has(url)) { picked.push({ url, kind: "project" }); seen.add(url); }
  return picked.slice(0, MAX_PAGES);
}

/**
 * The plan for a site whose home page we already have: its robots.txt and
 * sitemap (read side by side), plus every link on the home page.
 */
export async function planCrawl(home: Fetched, get: Getter = safeGet): Promise<PlannedPage[]> {
  const origin = new URL(home.url).origin;
  const robots = await get(`${origin}/robots.txt`).then((r) => (/html/i.test(r.contentType) ? parseRobots("") : parseRobots(r.body))).catch(() => parseRobots(""));
  const sitemapStarts = robots.sitemaps.filter((s) => { try { return new URL(s).host === new URL(origin).host; } catch { return false; } });
  const fromSitemap = await readSitemaps(sitemapStarts.length ? sitemapStarts : [`${origin}/sitemap.xml`], get);
  const candidates = [
    ...pageLinks(home.body, home.url).map((l) => ({ ...l, fromPage: true })),
    ...fromSitemap.flatMap((s) => { try { return [{ url: new URL(s), label: "", fromPage: false }]; } catch { return []; } }),
  ];
  return pickPages(home.url, candidates, robots);
}

/**
 * Project and service pages linked only from the work or services page (not
 * the menu or the sitemap): found once those pages are read, so a crawl reads
 * in two waves. Returns the new pages, within the same per-kind limits.
 */
export function followUp(read: ReadPage[], plan: PlannedPage[]): PlannedPage[] {
  const have = new Set(plan.map((p) => canonical(new URL(p.url))));
  const count = (k: PageKind) => plan.filter((p) => p.kind === k).length;
  const room: Partial<Record<PageKind, number>> = { project: MAX_PROJECTS - count("project"), service: MAX_SERVICES - count("service") };
  const out: PlannedPage[] = [];
  for (const page of read.filter((p) => p.kind === "work" || p.kind === "services")) {
    for (const { url, label } of pageLinks(page.html, page.url)) {
      const kind = classify(url, label);
      const key = canonical(url);
      if ((kind !== "project" && kind !== "service") || have.has(key) || (room[kind] ?? 0) <= 0) continue;
      have.add(key);
      room[kind] = (room[kind] ?? 0) - 1;
      out.push({ url: key, kind });
    }
  }
  return out.slice(0, Math.max(0, MAX_PAGES - plan.length));
}

/** Both waves inside one budget: the plan, then what its work and services pages link to. */
export async function crawl(plan: PlannedPage[], opts: { get?: Getter; budgetMs?: number } = {}): Promise<{ pages: ReadPage[]; skipped: PlannedPage[] }> {
  const budget = opts.budgetMs ?? 20_000;
  const start = Date.now();
  const first = await readPages(plan, { get: opts.get, budgetMs: budget });
  const more = followUp(first.pages, plan);
  const left = budget - (Date.now() - start);
  if (!more.length || left < 1500) return first;
  const second = await readPages(more, { get: opts.get, budgetMs: left });
  return { pages: [...first.pages, ...second.pages], skipped: [...first.skipped, ...second.skipped] };
}

// ---- reading -------------------------------------------------------------------

/**
 * Reads a plan a few pages at a time. HTML only. Each page is its own try: a
 * 404, a timeout or a page past the budget is skipped. Pages come back in plan order.
 */
export async function readPages(plan: PlannedPage[], opts: { get?: Getter; concurrency?: number; budgetMs?: number } = {}): Promise<{ pages: ReadPage[]; skipped: PlannedPage[] }> {
  const get = opts.get ?? safeGet;
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const results: (ReadPage | null)[] = plan.map(() => null);
  let next = 0;
  const worker = async () => {
    while (next < plan.length) {
      const i = next++;
      const p = plan[i];
      const left = deadline - Date.now();
      if (left <= 0) return;
      const r = await Promise.race([get(p.url).catch(() => null), new Promise<null>((res) => setTimeout(() => res(null), left))]);
      if (r && (/html/i.test(r.contentType) || (!r.contentType && /<html|<body/i.test(r.body)))) results[i] = { ...p, url: r.url, html: r.body };
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 5, plan.length) }, worker));
  return {
    pages: results.filter((r): r is ReadPage => !!r),
    skipped: plan.filter((_, i) => !results[i]),
  };
}

/** True when a page sends almost no words and leaves the rest to its scripts (a single-page app). */
export function scriptOnly(html: string): boolean {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const words = body.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").split(/\s+/).filter((w) => /\w{2,}/.test(w)).length;
  return words < 40 && /<script\b/i.test(html);
}
