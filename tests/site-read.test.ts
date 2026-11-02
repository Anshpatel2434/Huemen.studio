/**
 * Reading a brand off its website, one case per problem a real-site test
 * turned up (sahil-gandhi.com, basecamp.com, stripe.com, linear.app,
 * marieforleo.com), plus the onboarding read (lib/integrations/site) and the
 * site_profile task's stand-in.
 */
import { describe, it, expect } from "vitest";
import { coloursIn, extractSiteBrand, orderPalette, pageMeta } from "@/lib/visual/core";
import { findAboutLink, readSite } from "@/lib/integrations/site";
import type { Getter } from "@/lib/integrations/web";
import { siteProfile } from "@/lib/ai/tasks";

describe("page name and description", () => {
  it("keeps an apostrophe inside a double-quoted description (it used to stop at \"You don\")", () => {
    const html = `<head><title>Sahil Gandhi | The Brand Professor</title><meta name="description" content="You don't need more content. You need a brand that sells."></head>`;
    expect(pageMeta(html)).toEqual({ title: "Sahil Gandhi", description: "You don't need more content. You need a brand that sells." });
  });
  it("reads single-quoted values with double quotes inside, entities, and og: tags in either attribute order", () => {
    const html = `<meta content='Coaching for "first-time" managers &amp; their teams' property='og:description'><meta property="og:site_name" content="Rivera Coaching"><title>Home - Rivera</title>`;
    expect(pageMeta(html)).toEqual({ title: "Rivera Coaching", description: 'Coaching for "first-time" managers & their teams' });
  });
});

describe("fonts", () => {
  it("drops icon fonts and !important (Webflow sites listed \"webflow-icons!important\")", () => {
    const b = extractSiteBrand("<html></html>", [`.w-icon{font-family:"webflow-icons"!important} .fa{font-family:"Font Awesome 6 Free"} h1{font-family:Didot,serif} body{font-family:"Quentin webfont" !important}`], "https://x.example/");
    expect(b.fonts).toEqual(["Didot", "Quentin webfont"]);
  });
  it("follows var() to the family it names", () => {
    expect(extractSiteBrand("", [":root{--font-display:'Söhne',sans-serif} h1{font-family:var(--font-display)}"], "https://x.example/").fonts).toEqual(["Söhne"]);
  });
});

describe("logo", () => {
  it("prefers the site's icon to the social share image (a banner, not a mark)", () => {
    const html = `<meta property="og:image" content="/images/og-image.jpg"><link rel="icon" href="/favicon.ico"><link rel="icon" type="image/png" href="/icon-192.png">`;
    expect(extractSiteBrand(html, [], "https://sahil.example/").logo).toBe("https://sahil.example/icon-192.png");
  });
  it("still takes a logo image on the page over any icon", () => {
    const html = `<link rel="apple-touch-icon" href="/touch.png"><header><img alt="Rivera logo" src="/brand/mark.svg"></header>`;
    expect(extractSiteBrand(html, [], "https://r.example/").logo).toBe("https://r.example/brand/mark.svg");
  });
  it("falls back to the share image when there is nothing else", () => {
    expect(extractSiteBrand(`<meta property="og:image" content="https://cdn.example/og.png">`, [], "https://r.example/").logo).toBe("https://cdn.example/og.png");
  });
});

describe("dark sites", () => {
  const css = `html{background:#08090a;color:#f7f8f8} .btn{background:#5e6ad2} a{color:#5e6ad2} .card{background:#e2e4e7}`;
  it("reports the page's own background as the ground", () => {
    expect(extractSiteBrand("", [css], "https://dark.example/").ground).toBe("#08090A");
  });
  it("orders a dark site's palette ground first, not the lightest colour (linear.app got a light grey ground)", () => {
    const b = extractSiteBrand("", [css], "https://dark.example/");
    expect(orderPalette(b.palette, b.ground)[0]).toBe("#08090A");
    expect(orderPalette(b.palette, b.ground)[1]).toBe("#5E6AD2");
  });
  it("trusts a page that says it is dark when its CSS background can't be followed (linear.app: data-theme=\"dark\")", () => {
    const html = `<html lang="en" data-theme="dark"><head><meta name="theme-color" content="#08090a"></head>`;
    const b = extractSiteBrand(html, [`html{background:var(--bg-primary)} [data-theme=light]{--bg-primary:#ffffff} .card{background:#ffebc6}`], "https://l.example/");
    expect(b.ground).toBe("#08090A");
    expect(orderPalette(b.palette, b.ground)[0]).toBe("#08090A");
  });
  it("takes the most-used real colour as the accent, not the most saturated (stripe.com came out orange)", () => {
    expect(orderPalette(["#FFFFFF", "#533AFD", "#000000", "#FF6118"])[1]).toBe("#533AFD");
  });
  it("still puts the lightest colour first when a site declares no background", () => {
    expect(orderPalette(["#111111", "#FF3429", "#FAFAFA"])[0]).toBe("#FAFAFA");
  });
});

describe("colours", () => {
  it("reads rgb(), hsl() and oklch() as well as hex, and skips see-through ones", () => {
    expect(coloursIn("rgb(255, 52, 41) rgb(35 119 210 / 100%) hsl(120 100% 25%) rgba(0,0,0,.2) oklch(62.8% 0.2577 29.23)")).toEqual(["#FF3429", "#2377D2", "#008000", "#FF0000"]);
  });
  it("finds a brand written only in oklch() custom properties (basecamp.com came back with two colours)", () => {
    const b = extractSiteBrand("", [":root{--color-brand: oklch(0.85 0.17 95); --color-ink: oklch(0.2 0 0)} .btn{background:var(--color-brand)} body{color:var(--color-ink)}"], "https://b.example/");
    expect(b.palette.some((h) => parseInt(h.slice(1, 3), 16) > 200 && parseInt(h.slice(5, 7), 16) < 60)).toBe(true); // a strong yellow
  });
  it("ranks the colour on buttons and links above colours that only appear in gradients (stripe.com's decoration outranked its blurple)", () => {
    const css = [
      ".hero{background:linear-gradient(90deg,#ffd601,#ee30fb,#ffd601,#ee30fb)} .blob{background:radial-gradient(#ffd601,#ee30fb)} .glow{box-shadow:0 0 40px #ee30fb}",
      ".btn{background:#635bff} a{color:#635bff}",
    ];
    const b = extractSiteBrand("", css, "https://s.example/");
    expect(b.palette.indexOf("#635BFF")).toBeLessThan(b.palette.indexOf("#EE30FB"));
    expect(orderPalette(b.palette, b.ground)).toContain("#635BFF");
  });
  it("counts custom properties named brand/primary/accent heavily", () => {
    const b = extractSiteBrand("", [":root{--primary:#c2410c} .x{color:#2563eb} .y{color:#2563eb} .z{color:#2563eb}"], "https://p.example/");
    expect(b.palette.indexOf("#C2410C")).toBeLessThan(b.palette.indexOf("#2563EB"));
  });
  it("does not read link fragments like href=\"#add\" as colours", () => {
    expect(extractSiteBrand(`<a href="#add">Add</a><a href="#bead">x</a>`, [], "https://f.example/").palette).toEqual([]);
  });
});

describe("the onboarding read", () => {
  const pages: Record<string, string> = {
    "https://rivera.example/": `<html><head><title>Alex Rivera | Leadership coaching</title>
      <meta name="description" content="Leadership coaching for first-time managers. I help engineers who've just been promoted lead without burning out.">
      <link rel="stylesheet" href="/s.css"><link rel="icon" href="/icon.png"></head>
      <body><nav><a href="/about">About</a><a href="/blog">Blog</a></nav><main><h1>Lead your first team</h1><p>1:1 coaching and a six-week cohort for new managers.</p></main></body></html>`,
    "https://rivera.example/s.css": "body{background:#fffdf8;color:#1b1b1b} .btn{background:#d9480f}",
    "https://rivera.example/about": "<main><h1>About</h1><p>I spent ten years shipping software before I managed anyone. Now I run workshops for engineering leaders.</p></main>",
  };
  const get: Getter = async (raw) => {
    const u = new URL(raw).toString(); // as a real fetch reports it: https://rivera.example/
    const body = pages[u];
    if (body === undefined) throw new Error("not found");
    return { url: u, contentType: "text/html", body };
  };

  it("finds the About page by its path or its label, on the same site only", () => {
    expect(findAboutLink(`<a href="https://other.example/about">About</a><a href="/our-story">x</a>`, "https://r.example/")).toBe("https://r.example/our-story");
    expect(findAboutLink(`<a href="/who"><span>About me</span></a>`, "https://r.example/")).toBe("https://r.example/who");
  });
  it("reads the brand, the name, the description and both pages' text", async () => {
    const r = await readSite("rivera.example", get);
    expect(r.title).toBe("Alex Rivera");
    expect(r.description).toContain("who've just been promoted");
    expect(r.palette[0]).toBe("#FFFDF8");
    expect(r.palette[1]).toBe("#D9480F");
    expect(r.dark).toBe(false);
    expect(r.logo).toBe("https://rivera.example/icon.png");
    expect(r.aboutUrl).toBe("https://rivera.example/about");
    expect(r.text).toMatch(/^\[Home page\]/);
    expect(r.text).toContain("[About page]");
    expect(r.text).toContain("ten years shipping software");
  });
  it("reads the whole page when its <article> is a near-empty card (sahil-gandhi.com gave 3 words)", async () => {
    const words = "We help founders get clear on the one brand decision they keep circling. ".repeat(8);
    const r = await readSite("https://card.example/", async (u) => ({ url: u, contentType: "text/html", body: `<body><section><h1>Clarity first</h1><p>${words}</p></section><article><p>New post</p></article></body>` }));
    expect(r.text).toContain("one brand decision");
  });
  it("still reads a site with no About page", async () => {
    const r = await readSite("https://rivera.example/", async (u) => (u.endsWith("/about") ? Promise.reject(new Error("404")) : get(u)));
    expect(r.aboutUrl).toBeNull();
    expect(r.text).not.toContain("[About page]");
  });

  it("the site_profile stand-in reads who it is for and what they offer", async () => {
    const r = await readSite("rivera.example", get);
    const input = [`Site: ${r.url}`, `Title: ${r.title}`, `Description: ${r.description}`, "", "Text:", r.text].join("\n");
    const p = siteProfile.schema.parse(siteProfile.mock(input));
    expect(p.name).toBe("Alex Rivera");
    expect(p.whatTheyDo).toBe("Leadership coaching for first-time managers.");
    expect(p.audience).toMatch(/^engineers who've just been promoted/); // "I help X" wins over "coaching for Y"
    expect(p.offers).toContain("coaching");
    expect(p.offers).toContain("workshops");
  });
});
