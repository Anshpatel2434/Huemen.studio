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
