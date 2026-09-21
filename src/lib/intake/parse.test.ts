import { describe, it, expect } from "vitest";
import { parseIntake, mergeIntake } from "./parse";
import { findViolations, splitDraft } from "@/lib/content/formats";
import type { FoundationForm } from "@/lib/data/foundation-types";

const EMPTY: FoundationForm = {
  niche: "", positioning: "", offers: "", audience: "",
  chapters: [{ title: "", body: "" }, { title: "", body: "" }, { title: "", body: "" }],
  tone: "", doWords: "", dontWords: "", readingLevel: "", samplePosts: "", palette: "", fonts: "", imageStyleNotes: "",
};

describe("parseIntake", () => {
  it("maps labelled lines and headed sections to fields", () => {
    const r = parseIntake(`Niche: Pricing for SaaS
Audience: Seed founders
## Don't words
- synergy
- leverage
Tone: sharp; contrarian
Brand colours are #0b0b0b and #FF3429`);
    expect(r.fields.niche).toBe("Pricing for SaaS");
    expect(r.fields.audience).toBe("Seed founders");
    expect(r.fields.dontWords).toBe("synergy, leverage");
    expect(r.fields.tone).toBe("sharp, contrarian");
    expect(r.fields.palette).toBe("#0B0B0B, #FF3429");
  });

  it("reports unlabelled text instead of guessing", () => {
    const r = parseIntake("just some rambling notes\nNiche: Coaching");
    expect(r.unplaced).toBe("just some rambling notes");
    expect(r.fields.niche).toBe("Coaching");
  });

  it("merges only non-empty parsed values over the existing brief", () => {
    const base = { ...EMPTY, niche: "Old niche", audience: "Kept" };
    const merged = mergeIntake(base, parseIntake("Niche: New niche\nOrigin: Started in 2015"));
    expect(merged.niche).toBe("New niche");
    expect(merged.audience).toBe("Kept");
    expect(merged.chapters[0]).toEqual({ title: "Origin", body: "Started in 2015" });
  });
});

describe("content helpers", () => {
  it("splits a draft into hook, body and CTA", () => {
    expect(splitDraft("Hook line\n\nBody one\n\nBody two\n\n→ Comment below")).toEqual({
      hook: "Hook line", body: "Body one\n\nBody two", cta: "Comment below",
    });
  });

  it("flags don't-words on word boundaries only", () => {
    expect(findViolations("We leverage synergy.", ["leverage", "synergy", "hustle"])).toEqual(["leverage", "synergy"]);
    expect(findViolations("leveraged buyouts", ["leverage"])).toEqual([]);
  });
});
