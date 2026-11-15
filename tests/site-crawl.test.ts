/**
 * The website crawler and the rules that read it (no model): which pages are
 * worth reading, robots.txt, sitemaps, the budget, and what a small agency
 * site says about itself (services, projects, testimonials, clients,
 * contact). Each rule case comes from a real site the smoke run read
 * (npm run smoke:site): Focus Lab, Pentagram, Wolff Olins, Basecamp, sahil-gandhi.com.
 */
import { describe, it, expect } from "vitest";
import { classify, crawl, followUp, parseRobots, pickPages, readPages, robotsAllows, scriptOnly, sitemapUrls, planCrawl, type ReadPage } from "@/lib/integrations/crawl";
import { extractDetails, profileFrom } from "@/lib/integrations/site-details";
import { proofsFromSite } from "@/lib/onboarding/site-proofs";
import type { Getter } from "@/lib/integrations/web";

const u = (p: string) => new URL(p, "https://studio.example/");

describe("which pages are worth reading", () => {
  it("names a page by its path", () => {
    expect(classify(u("/"))).toBe("home");
    expect(classify(u("/about-us/"))).toBe("about");
    expect(classify(u("/work-with-me"))).toBe("services");
    expect(classify(u("/services/brand-strategy"))).toBe("service");
    expect(classify(u("/case-studies/acme"))).toBe("project");
    expect(classify(u("/portfolio_page/acme"))).toBe("project");
    expect(classify(u("/en/about"))).toBe("about");
    expect(classify(u("/testimonials"))).toBe("testimonials");
  });
  it("leaves out posts, shop, legal pages and files", () => {
    for (const p of ["/blog/how-to", "/privacy-policy", "/shop", "/wp-content/x.pdf", "/careers", "/tag/brand", "/work/deck.pdf"]) expect(classify(u(p))).toBeNull();
  });
  it("falls back to the link's label when the path says nothing (\"Our work\" pointing at /selected)", () => {
    expect(classify(u("/selected"), "Our work")).toBe("work");
    expect(classify(u("/selected"))).toBeNull();
  });
  it("prefers the menu's page to a sitemap's, keeps one per section, and caps services and projects", () => {
    const robots = parseRobots("");
    const plan = pickPages("https://studio.example/", [
      { url: u("/about-the-studio-and-team-in-depth"), label: "", fromPage: false },
      { url: u("/about"), label: "About", fromPage: true },
      ...Array.from({ length: 12 }, (_, i) => ({ url: u(`/work/project-${i}`), label: "", fromPage: false })),
      ...Array.from({ length: 6 }, (_, i) => ({ url: u(`/services/s-${i}`), label: "", fromPage: true })),
      { url: new URL("https://other.example/about"), label: "About", fromPage: true },
    ], robots);
    expect(plan[0]).toEqual({ url: "https://studio.example/", kind: "home" });
    expect(plan.filter((p) => p.kind === "about")).toEqual([{ url: "https://studio.example/about", kind: "about" }]);
    expect(plan.filter((p) => p.kind === "project").length).toBe(8);
    expect(plan.filter((p) => p.kind === "service").length).toBe(4);
    expect(plan.every((p) => p.url.startsWith("https://studio.example/"))).toBe(true);
    expect(plan.length).toBeLessThanOrEqual(16);
  });
});

describe("robots.txt and sitemaps", () => {
  const robots = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /work/private
Disallow: /*.json$
Allow: /work/private/public-one
Sitemap: https://studio.example/sitemap_index.xml
`);
  it("follows the rules for every crawler, not another crawler's", () => {
    expect(robotsAllows(robots, u("/about"))).toBe(true);
    expect(robotsAllows(robots, u("/work/private/x"))).toBe(false);
    expect(robotsAllows(robots, u("/work/private/public-one"))).toBe(true);
    expect(robotsAllows(robots, u("/data.json"))).toBe(false);
    expect(robots.sitemaps).toEqual(["https://studio.example/sitemap_index.xml"]);
  });
  it("never plans a page robots.txt asks us to leave", () => {
    const plan = pickPages("https://studio.example/", [{ url: u("/work/private"), label: "Work", fromPage: true }], robots);
    expect(plan.map((p) => p.kind)).toEqual(["home"]);
  });
  it("reads a sitemap and a sitemap index", () => {
    expect(sitemapUrls(`<urlset><url><loc>https://studio.example/about</loc></url><url><loc><![CDATA[https://studio.example/work/a?x=1&amp;y=2]]></loc></url></urlset>`))
      .toEqual({ index: false, urls: ["https://studio.example/about", "https://studio.example/work/a?x=1&y=2"] });
    expect(sitemapUrls(`<sitemapindex><sitemap><loc>https://studio.example/page-sitemap.xml</loc></sitemap></sitemapindex>`).index).toBe(true);
  });
  it("plans from robots.txt, the sitemap index (pages before posts) and the home page's links", async () => {
    const files: Record<string, string> = {
      "https://studio.example/robots.txt": "User-agent: *\nDisallow: /contact\nSitemap: https://studio.example/sitemap_index.xml",
      "https://studio.example/sitemap_index.xml": `<sitemapindex><sitemap><loc>https://studio.example/post-sitemap.xml</loc></sitemap><sitemap><loc>https://studio.example/page-sitemap.xml</loc></sitemap></sitemapindex>`,
      "https://studio.example/page-sitemap.xml": `<urlset><url><loc>https://studio.example/work/acme</loc></url><url><loc>https://studio.example/testimonials</loc></url></urlset>`,
      "https://studio.example/post-sitemap.xml": `<urlset><url><loc>https://studio.example/work/should-not-be-read</loc></url></urlset>`,
    };
    const asked: string[] = [];
    const get: Getter = async (url) => {
      asked.push(url);
      if (!(url in files)) throw new Error("404");
      return { url, contentType: url.endsWith(".txt") ? "text/plain" : "application/xml", body: files[url] };
    };
    const plan = await planCrawl({ url: "https://studio.example/", contentType: "text/html", body: `<nav><a href="/about">About</a><a href="/contact">Contact</a></nav>` }, get);
    expect(plan.map((p) => `${p.kind} ${new URL(p.url).pathname}`)).toEqual(["home /", "about /about", "testimonials /testimonials", "project /work/acme"]);
    expect(asked).not.toContain("https://studio.example/post-sitemap.xml");
  });
});

describe("reading the pages", () => {
  const html = (body: string) => ({ contentType: "text/html; charset=utf-8", body: `<html><body>${body}</body></html>` });
  it("skips what fails, what isn't a page, and what runs past the budget, and keeps plan order", async () => {
    const get: Getter = async (url) => {
      if (url.endsWith("/broken")) throw new Error("500");
      if (url.endsWith("/slow")) return new Promise((r) => setTimeout(() => r({ url, ...html("late") }), 400));
      if (url.endsWith("/file")) return { url, contentType: "application/pdf", body: "%PDF" };
      return { url, ...html(url) };
    };
    const plan = ["/", "/broken", "/slow", "/file", "/about"].map((p, i) => ({ url: `https://studio.example${p}`, kind: (i ? "about" : "home") as "home" | "about" }));
    const t0 = Date.now();
    const r = await readPages(plan, { get, budgetMs: 150 });
    expect(Date.now() - t0).toBeLessThan(380);
    expect(r.pages.map((p) => new URL(p.url).pathname)).toEqual(["/", "/about"]);
    expect(r.skipped.map((p) => new URL(p.url).pathname).sort()).toEqual(["/broken", "/file", "/slow"]);
  });
  it("finds project pages the work page links to, and reads them in a second wave", async () => {
    const pages: Record<string, string> = {
      "https://studio.example/": `<a href="/work">Work</a>`,
      "https://studio.example/work": `<a href="/work/acme"><h3>Acme</h3></a><a href="/work/beta"><h3>Beta</h3></a><a href="/blog/x">Blog</a>`,
      "https://studio.example/work/acme": `<h1>Acme rebrand</h1>`,
      "https://studio.example/work/beta": `<h1>Beta launch</h1>`,
    };
    const get: Getter = async (url) => ({ url, contentType: "text/html", body: pages[url] ?? "" });
    const plan = [{ url: "https://studio.example/", kind: "home" as const }, { url: "https://studio.example/work", kind: "work" as const }];
    expect(followUp([{ ...plan[1], html: pages["https://studio.example/work"] }], plan).map((p) => p.url)).toEqual(["https://studio.example/work/acme", "https://studio.example/work/beta"]);
    const r = await crawl(plan, { get, budgetMs: 5000 });
    expect(r.pages.map((p) => `${p.kind} ${new URL(p.url).pathname}`)).toEqual(["home /", "work /work", "project /work/acme", "project /work/beta"]);
  });
  it("spots a page that leaves everything to its scripts", () => {
    expect(scriptOnly(`<html><body><div id="root"></div><script src="/app.js"></script></body></html>`)).toBe(true);
    expect(scriptOnly(`<html><body><main><p>${"Words about the studio and its work. ".repeat(10)}</p></main><script></script></body></html>`)).toBe(false);
  });
});

// ---- the rules -------------------------------------------------------------------

const page = (url: string, kind: ReadPage["kind"], body: string, head = ""): ReadPage => ({ url, kind, html: `<!doctype html>\n<html><head>${head}</head><body>${body}</body></html>` });
const site: ReadPage[] = [
  page("https://studio.example/", "home", `
    <header><nav><a href="/about">About</a><a href="/services">Services</a></nav></header>
    <main>
      <h1>Brands that sell for founders who hate fluff</h1>
      <section class="clients"><h2>Trusted by</h2>
        <img src="/logos/acme-logo.svg" alt="Acme logo"><img src="/logos/beta.svg" alt="Beta Corp"><img src="/logos/6151a0b9d2c3e4f5a6b7c8d9_arrow.svg" alt=""><img src="/logos/gamma.png" alt="Gamma">
      </section>
      <figure><blockquote>“They rebuilt our brand in six weeks and our close rate went up by a third.”</blockquote><figcaption>Priya Shah, CEO, Acme</figcaption></figure>
      <section class="team-photos"><img src="/team/a.jpg" alt="Dan Owen"><img src="/team/b.jpg" alt="Philip Lakin"><img src="/team/c.jpg" alt="Charley Todd"></section>
    </main>
    <footer><a href="mailto:hello@studio.example">Email</a><a href="tel:+44 20 7946 0000">Call</a>
      <a href="https://www.linkedin.com/company/studio-example/">LinkedIn</a><a href="https://twitter.com/intent/tweet?text=hi">Share</a><a href="https://instagram.com/studio.example">IG</a></footer>`,
    `<title>Home | Rivera Studio</title><meta property="og:site_name" content="Rivera Studio"><meta name="description" content="Rivera Studio is a brand studio in London. We help founders turn expertise into a brand people buy.">
     <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Some Other Org","url":"https://other.example/"},{"@type":"ProfessionalService","name":"Rivera Studio","url":"https://studio.example/","telephone":"+44 20 7946 0000","address":{"@type":"PostalAddress","streetAddress":"1 Shoreditch High St","addressLocality":"London","postalCode":"E1 6JE","addressCountry":"GB"},"sameAs":["https://www.youtube.com/@riverastudio"]}]}</script>`),
  page("https://studio.example/about", "about", `<main><h1>About</h1><p>We started Rivera Studio in 2016 after a decade inside agencies that sold decks instead of results for their clients.</p><p>Short.</p></main>`, `<title>About | Rivera Studio</title>`),
  page("https://studio.example/services", "services", `<main>
    <h2>How a project works.</h2><p>We start with a call and a written plan for everything.</p>
    <div class="card"><h3>Brand strategy</h3><p>Positioning, audience and the one idea that carries every piece of work.</p></div>
    <div class="card"><h3>Visual identity</h3><p>Logo, type and colour that look like you on every channel you use.</p></div>
    <div class="card"><h3>Website design</h3><p>A site that explains what you do in five seconds and books calls.</p></div>
    <h2>Ready to talk?</h2>
    <div class="split"><h4>Hear</h4><h4>what</h4><h4>it's</h4><h4>like</h4></div>
  </main>`, `<title>Services | Rivera Studio</title>`),
  page("https://studio.example/work/acme", "project", `<header><h1 class="logo">Rivera Studio</h1></header><main><h1>Acme rebrand</h1>
    <div class="meta"><span>Client</span><span>Acme Ltd</span></div>
    <div class="labels"><span>Services Provided</span><span>Brand Strategy</span><span>Visual Identity</span><span>Web Design</span><span>Post Project</span><span>$4M Raised</span></div>
    <p>Acme came to us with a product people loved and a brand nobody remembered after the first meeting.</p>
    <div class="testimonial"><div class="testimonial-top"><div>Priya Shah</div><div>CEO, Acme</div></div><div class="testimonial-copy">“Rivera gave us a story our sales team actually tells, and a look that made us feel twice our size.”</div></div>
  </main>`, `<title>Acme rebrand | Rivera Studio</title><meta property="og:image" content="/img/acme-cover.jpg"><meta property="og:description" content="A rebrand that took Acme from forgettable to the obvious choice.">`),
  page("https://studio.example/contact", "contact", `<main><p>Write to us at projects@studio.example or call.</p><script>var x="tracker@sentry.example"</script></main>`),
];

describe("what the site says, by rules", () => {
  const d = extractDetails(site);
  it("takes the site's own name, not another organisation in its structured data", () => {
    expect(d.name).toBe("Rivera Studio");
    expect(d.tagline).toBe("Brands that sell for founders who hate fluff");
    expect(d.summary).toMatch(/^Rivera Studio is a brand studio in London/);
    expect(d.about).toMatch(/^We started Rivera Studio in 2016/);
    expect(d.about).not.toMatch(/Short\./);
  });
  it("finds the services as a row of names, not the page's section headings or split-up words", () => {
    expect(d.services.map((s) => s.name)).toEqual(["Brand strategy", "Visual identity", "Website design"]);
    expect(d.services[0].about).toMatch(/^Positioning, audience/);
    expect(d.services[0].from).toBe("https://studio.example/services");
  });
  it("reads a project page: its own title (not the logo), client, a clean result, summary and image", () => {
    expect(d.projects).toHaveLength(1);
    expect(d.projects[0]).toMatchObject({
      title: "Acme rebrand", client: "Acme Ltd", result: "$4M Raised",
      summary: "A rebrand that took Acme from forgettable to the obvious choice.", image: "https://studio.example/img/acme-cover.jpg", url: "https://studio.example/work/acme",
    });
  });
  it("finds testimonials in quote blocks and in testimonial cards, with who said them", () => {
    expect(d.testimonials).toEqual([
      { quote: "They rebuilt our brand in six weeks and our close rate went up by a third.", author: "Priya Shah", role: "CEO, Acme", from: "https://studio.example/" },
      { quote: "Rivera gave us a story our sales team actually tells, and a look that made us feel twice our size.", author: "Priya Shah", role: "CEO, Acme", from: "https://studio.example/work/acme" },
    ]);
  });
  it("takes client logos from a logo row, not hashed file names or a grid of photos", () => {
    expect(d.clients.map((c) => c.name)).toEqual(["Acme", "Beta Corp", "Gamma"]);
    expect(d.clients[0].logo).toBe("https://studio.example/logos/acme-logo.svg");
  });
  it("collects contact details and profiles, without share links or emails inside scripts", () => {
    expect(d.contact.emails.sort()).toEqual(["hello@studio.example", "projects@studio.example"]);
    expect(d.contact.phones).toEqual(["+44 20 7946 0000"]);
    expect(d.contact.address).toBe("1 Shoreditch High St, London, E1 6JE, GB");
    expect(d.socials.map((s) => s.network).sort()).toEqual(["Instagram", "LinkedIn", "YouTube"]);
    expect(d.socials.find((s) => s.network === "LinkedIn")?.url).toBe("https://www.linkedin.com/company/studio-example");
  });
  it("lists the pages it read", () => {
    expect(d.pages.map((p) => p.kind)).toEqual(["home", "about", "services", "project", "contact"]);
  });
  it("leaves what the site doesn't say empty instead of guessing", () => {
    const bare = extractDetails([page("https://bare.example/", "home", "<main><p>Hello.</p></main>", "<title>Bare</title>")]);
    expect(bare).toMatchObject({ name: "", tagline: "", about: "", services: [], projects: [], testimonials: [], clients: [], contact: { emails: [], phones: [], address: "" } });
    expect(extractDetails([page("https://bare.example/", "home", "", "<title>Bare</title>")], { title: "Bare" }).name).toBe("Bare");
  });
});

describe("the profile the next screens offer", () => {
  it("fills name, what they do, who it's for, offers and line from the details alone", () => {
    const p = profileFrom(extractDetails(site));
    expect(p).toEqual({
      name: "Rivera Studio",
      whatTheyDo: "Rivera Studio is a brand studio in London.",
      audience: "founders",
      offers: "Brand strategy, Visual identity, Website design",
      positioning: "Brands that sell for founders who hate fluff",
    });
  });
  it("finds the audience in the third person too, and never answers \"you\"", () => {
    const base = extractDetails([]);
    expect(profileFrom({ ...base, summary: "Marie Forleo helps entrepreneurs achieve financial freedom." }).audience).toBe("entrepreneurs");
    expect(profileFrom({ ...base, summary: "I help you find your voice." }).audience).toBe("");
    expect(profileFrom({ ...base, summary: "Coaching for first-time managers and their teams." }).audience).toBe("first-time managers and their teams");
  });
});

describe("keeping what the site shows as facts", () => {
  const d = extractDetails(site);
  it("words a project and a testimonial as facts with their page as the source", () => {
    expect(proofsFromSite(d, { projects: [0], testimonials: [0] })).toEqual([
      { claim: "Project: Acme rebrand (for Acme Ltd). $4M Raised.", source: "studio.example/work/acme" },
      { claim: "A client said: \"They rebuilt our brand in six weeks and our close rate went up by a third.\" (Priya Shah, CEO, Acme)", source: "studio.example" },
    ]);
  });
  it("ignores positions that aren't there, repeats and anything that isn't a position", () => {
    expect(proofsFromSite(d, { projects: [0, 0, 5, -1], testimonials: ["0" as unknown as number] })).toHaveLength(1);
    expect(proofsFromSite(d, null as unknown as { projects: number[]; testimonials: number[] })).toEqual([]);
  });
});

describe("cookie banners", () => {
  it("never reads a cookie or consent banner as the About text, and keeps a page wrapped in a cookie-named div", () => {
    const about = page("https://studio.example/about", "about", `<div class="page cookies-accepted"><main>
      <p>We started Rivera Studio in 2016 after a decade inside agencies that sold decks instead of results for their clients.</p>
      ${"<p>More about how we work with founders and their teams, week by week, on the brand they will grow into.</p>".repeat(8)}
      <div class="fs-consent_banner"><p>By clicking "Accept", you agree to the storing of cookies on your device to enhance site navigation and analyse site usage.</p></div>
      <p>We use cookies to give you the best experience on our website and to understand how you use it. Read our privacy policy.</p>
    </main></div>`);
    const d = extractDetails([page("https://studio.example/", "home", "<main><h1>Hi there friends</h1></main>"), about]);
    expect(d.about).toMatch(/^We started Rivera Studio/);
    expect(d.about).not.toMatch(/cookies/i);
  });
});
