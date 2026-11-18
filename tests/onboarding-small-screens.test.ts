/**
 * Small onboarding fixes from the 2026-11-18 recorded run: the site's facts
 * start unticked (with Tick all), the Writing screen lists what is on file,
 * and the Look screen's colour tag stops claiming the site once edited.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { colourSource, pieceExcerpt, pieceLabel, savedPieces, siteDomain } from "@/app/w/[id]/onboarding/screen-text";
import { SiteDetailsCard } from "@/app/w/[id]/onboarding/site-details-card";
import type { SiteDetails } from "@/lib/integrations/site-details";

const details: SiteDetails = {
  name: "Focus Lab", tagline: "", summary: "", about: "",
  services: [],
  projects: [
    { title: "Rebrand for Acme", summary: "A full rebrand.", client: "Acme", result: "Doubled leads", image: null, url: "https://focuslab.agency/work/acme", from: "https://focuslab.agency/work" },
    { title: "Site for Beta", summary: "", client: "", result: "", image: null, url: "https://focuslab.agency/work/beta", from: "https://focuslab.agency/work" },
  ],
  testimonials: [{ quote: "They changed how we sell.", author: "Sam", role: "CEO", from: "https://focuslab.agency/" }],
  clients: [], contact: { emails: [], phones: [], address: "" }, socials: [],
  pages: [{ url: "https://focuslab.agency/", kind: "home", title: "Home" }],
  scriptOnly: 0,
};

describe("site facts start unticked", () => {
  const html = renderToStaticMarkup(createElement(SiteDetailsCard, { tenantId: "t", details }));

  it("renders every keep tick as off", () => {
    const pressed = [...html.matchAll(/aria-pressed="(true|false)"/g)].map((m) => m[1]);
    expect(pressed).toHaveLength(3);
    expect(pressed.every((p) => p === "false")).toBe(true);
  });

  it("offers Tick all, and the save button asks for a pick", () => {
    expect(html).toContain("Tick all");
    expect(html).not.toContain("Untick all");
    expect(html).toContain("Tick some to keep");
  });
});

describe("Writing screen: what is on file", () => {
  it("names a piece by channel and how it arrived", () => {
    expect(pieceLabel("linkedin", "paste")).toBe("LinkedIn · pasted");
    expect(pieceLabel("newsletter", "url")).toBe("Newsletter or blog · link");
    expect(pieceLabel("linkedin", "export")).toBe("LinkedIn · export");
    expect(pieceLabel("spoken", "voice_note")).toBe("Spoken answer");
    expect(pieceLabel("unknown", "paste")).toBe("Writing · pasted");
    expect(pieceLabel("podcast", "nothing-known")).toBe("Podcast");
  });

  it("quotes the first line, cut at a word", () => {
    expect(pieceExcerpt("\n\n  Hello   there.\nSecond line")).toBe("Hello there.");
    const long = "Most managers think the job is having answers, but the job is asking better questions of the people closest to the work every week";
    const cut = pieceExcerpt(long, 60);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(61);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1)).not.toMatch(/\s$/);
  });

  it("lists newest first, capped, and uses a link's title", () => {
    const samples = [
      { id: "a", channel: "linkedin", source: "paste", body: "First post" },
      { id: "b", channel: "newsletter", source: "url", body: "Body text of the page", note: "Why I stopped hiring" },
      { id: "c", channel: "spoken", source: "voice_note", body: "I coach new managers." },
    ];
    const list = savedPieces(samples);
    expect(list.map((p) => p.id)).toEqual(["c", "b", "a"]);
    expect(list[1]).toEqual({ id: "b", label: "Newsletter or blog · link", excerpt: "Why I stopped hiring" });
    expect(savedPieces(samples, 2).map((p) => p.id)).toEqual(["c", "b"]);
  });
});

describe("Look screen: where a colour came from", () => {
  const site = "https://www.focuslab.agency/";
  const read = ["#F5F1EA", "#E8452C", "#111111"];

  it("names the site while both colours are the read ones (any case)", () => {
    expect(siteDomain(site)).toBe("focuslab.agency");
    expect(colourSource(["#f5f1ea", "#E8452C"], read, site)).toBe("From focuslab.agency");
  });

  it("says Your choice once both are changed", () => {
    expect(colourSource(["#FFFFFF", "#000000"], read, site)).toBe("Your choice");
  });

  it("names only the colour still from the site when one is changed", () => {
    expect(colourSource(["#F5F1EA", "#000000"], read, site)).toBe("Background from focuslab.agency");
    expect(colourSource(["#FFFFFF", "#E8452C"], read, site)).toBe("Accent from focuslab.agency");
  });

  it("shows nothing when no site was read or it had no colours", () => {
    expect(colourSource(["#FFFFFF", "#0A0A0A"], [], site)).toBeNull();
    expect(colourSource(["#FFFFFF", "#0A0A0A"], read, null)).toBeNull();
  });
});
