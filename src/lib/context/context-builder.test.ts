import { describe, it, expect } from "vitest";
import {
  buildBrandContext,
  CONTEXT_VERSION,
  type BrandContextInput,
} from "./context-builder";

const fullFoundation: BrandContextInput = {
  brandProfile: {
    storyArc: [
      { chapter: 1, title: "Origin", body: "Left corporate to coach founders." },
      { chapter: 2, title: "Struggle", body: "Learned brand is a system, not a logo." },
      { chapter: 3, title: "Now", body: "Helps experts package their authority." },
    ],
    positioningStatement: "The brand professor for solo experts.",
    niche: "Personal branding for B2B founders",
    audience: { role: "founders", stage: "post-PMF" },
    offersSummary: "1:1 coaching, cohort workshops.",
  },
  voiceGuide: {
    toneDescriptors: ["direct", "warm", "contrarian"],
    doWords: ["clarity", "authority", "system"],
    dontWords: ["synergy", "leverage", "guru"],
    samplePosts: ["Post one body.", "Post two body.", "Post three body."],
    readingLevel: "grade 8",
    formattingRules: { maxHashtags: 3 },
  },
  visualIdentity: {
    palette: ["#000000", "#FF3429", "#F4F4F4"],
    fonts: ["Borna", "Times"],
    imageStyleNotes: "Editorial, high-contrast, generous whitespace.",
    aspectRatioDefaults: { linkedin: "1200x1200" },
  },
};

describe("buildBrandContext (INV-2)", () => {
  it("stamps the current context version", () => {
    const ctx = buildBrandContext(fullFoundation);
    expect(ctx.version).toBe(CONTEXT_VERSION);
  });

  it("is deterministic — same input yields identical serialised output", () => {
    const a = buildBrandContext(fullFoundation);
    const b = buildBrandContext(fullFoundation);
    expect(a.serialized).toEqual(b.serialized);
    expect(a.completeness).toEqual(b.completeness);
  });

  it("scores a full foundation as complete and not degraded", () => {
    const ctx = buildBrandContext(fullFoundation);
    expect(ctx.completeness).toBe(100);
    expect(ctx.degraded).toBe(false);
    expect(ctx.warnings).toHaveLength(0);
  });

  it("marks a thin foundation as degraded and explains why (P1-10)", () => {
    const ctx = buildBrandContext({ brandProfile: { niche: "Coaching" } });
    expect(ctx.degraded).toBe(true);
    expect(ctx.completeness).toBeLessThan(50);
    expect(ctx.warnings.length).toBeGreaterThan(0);
    expect(ctx.warnings.join(" ")).toMatch(/positioning/i);
  });

  it("handles a completely empty foundation without throwing", () => {
    const ctx = buildBrandContext({});
    expect(ctx.completeness).toBe(0);
    expect(ctx.degraded).toBe(true);
    expect(typeof ctx.serialized).toBe("string");
  });

  it("exposes voice guardrails for post-generation checking (§4.2)", () => {
    const ctx = buildBrandContext(fullFoundation);
    expect(ctx.guardrails.dontWords).toContain("guru");
    expect(ctx.guardrails.doWords).toContain("clarity");
  });

  it("includes the brand voice and palette in the serialised block", () => {
    const ctx = buildBrandContext(fullFoundation);
    expect(ctx.serialized).toContain("## VOICE");
    expect(ctx.serialized).toContain("#FF3429");
    expect(ctx.serialized).toContain("contrarian");
  });

  it("defaults language to 'en' but keeps it a parameter (§09)", () => {
    expect(buildBrandContext(fullFoundation).language).toBe("en");
    expect(buildBrandContext({ ...fullFoundation, language: "hi" }).language).toBe("hi");
  });
});

// ---- 2026-11-18 audit: the rewrite and the reply carry their material (C2, H1) ----

const material = {
  stories: [{ title: "The pilot that failed", body: "Our first pilot closed in March." }],
  proofs: [{ claim: "12 founders coached through a first hire", source: "case notes" }],
};

describe("the rewrite and the reply carry the facts and stories their rules name (C2, H1)", () => {
  it("a rewrite block has the stories and the facts the rewrite rule cites", () => {
    const ctx = buildBrandContext({ voicePack: { ...material, corpusPieces: 20 }, task: "rewrite" });
    expect(ctx.serialized).toContain("Facts they can stand behind.");
    expect(ctx.serialized).toContain("12 founders coached through a first hire [case notes]");
    expect(ctx.serialized).toContain("The pilot that failed: Our first pilot closed in March.");
  });
  it("a reply block (LinkedIn comment, WhatsApp, Slack) has the facts and the stories", () => {
    const ctx = buildBrandContext({ voicePack: material, task: "reply" });
    expect(ctx.serialized).toContain("Facts they can stand behind.");
    expect(ctx.serialized).toContain("Stories they tell.");
    expect(ctx.serialized).toContain("The pilot that failed");
  });
  it("a check block still does not carry the material (it judges, it does not write)", () => {
    const ctx = buildBrandContext({ voicePack: material, task: "check" });
    expect(ctx.serialized).not.toContain("Facts they can stand behind.");
  });
});

describe("a cap on the brand context is recorded, never silent (H2)", () => {
  it("records a warning when a list the loader cut has more than it shows", () => {
    const ctx = buildBrandContext({ caps: [{ section: "Offers", shown: 12, total: 14 }, { section: "Content pillars", shown: 5, total: 5 }] });
    expect(ctx.warnings).toContain("Offers: 12 of 14 reach the prompt; the rest do not.");
    expect(ctx.warnings.some((w) => w.startsWith("Content pillars"))).toBe(false);
  });
  it("records a warning for an offer whose deliverables are cut, and keeps six", () => {
    const deliverables = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
    const ctx = buildBrandContext({ brandProfile: { offers: [{ name: "Cohort", deliverables }] } });
    expect(ctx.serialized).toContain("    Includes: One; Two; Three; Four; Five; Six");
    expect(ctx.serialized).not.toContain("Seven");
    expect(ctx.warnings).toContain('Offer "Cohort" lists 8 deliverables; 6 reach the prompt.');
  });
  it("cuts a long sample at a sentence and records it", () => {
    const sentence = "Every sentence here is a complete thought about the work. ";
    const body = sentence.repeat(40).trim(); // about 2,400 characters
    const ctx = buildBrandContext({ voicePack: { samples: [{ channel: "linkedin", body }] } });
    const shown = ctx.serialized.split("\n").find((l) => l.includes("(linkedin)")) ?? "";
    expect(shown.length).toBeLessThanOrEqual(1500 + "  [1] (linkedin) ".length);
    expect(shown.endsWith("the work.")).toBe(true);
    expect(ctx.warnings.some((w) => w.includes("Their writing sample 1 is longer than 1,500 characters"))).toBe(true);
  });
  it("keeps a short sample whole and records nothing about it", () => {
    const ctx = buildBrandContext({ voicePack: { samples: [{ channel: "linkedin", body: "A short post. It fits." }] } });
    expect(ctx.serialized).toContain("[1] (linkedin) A short post. It fits.");
    expect(ctx.warnings.some((w) => w.includes("longer than"))).toBe(false);
  });
});
