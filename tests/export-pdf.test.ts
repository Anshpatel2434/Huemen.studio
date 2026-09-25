/** The PDF export renders a real, multi-page document from project data. */
import { describe, it, expect } from "vitest";
import { buildPdf } from "@/lib/export/pdf";
import type { FoundationForm } from "@/lib/data/foundation-types";

const foundation: FoundationForm = {
  niche: "Leadership coaching", positioning: "I help new managers stop firefighting.", offers: "1:1, cohort",
  audience: "First-time engineering managers", chapters: [{ title: "Origin", body: "Promoted too early." }, { title: "Turn", body: "Kept a decision log." }, { title: "Now", body: "I coach managers." }],
  tone: "direct, warm", doWords: "clarity, ownership", dontWords: "synergy, rockstar", readingLevel: "Plain English",
  samplePosts: "Your first 90 days decide the next three years.", palette: "#0A0A0A, #FFFFFF", fonts: "Inter",
  imageStyleNotes: "Natural light, no stock handshakes.",
};

describe("pdf export", () => {
  it("renders a PDF with the brief, pillars, offers, calendar and content", async () => {
    const buf = await buildPdf({
      brandName: "Demo Brand",
      foundation,
      pillars: [{ id: "p1", name: "Contrarian takes", description: "Where I disagree", contentCount: 1, ideaCount: 0, calendarCount: 1, formats: ["linkedin_post"] }],
      content: [{
        id: "c1", format: "linkedin_post", channel: "linkedin", topic: "Hiring", hook: "Hook line", body: "Body copy", cta: "Comment below",
        status: "approved", pillarId: "p1", pillarName: "Contrarian takes", violations: [], history: [], promptVersion: 1, createdAt: new Date().toISOString(),
      } as never],
      calendar: [{ id: "e1", date: "2026-10-01", pillarId: "p1", pillarName: "Contrarian takes", channel: "linkedin", topic: "Hiring", hookAngle: "A story", cta: "Comment", contentItemId: null } as never],
      offers: [{ id: "o1", name: "Cohort", format: "6 weeks", promise: "Judgement training", deliverables: ["Six sessions"], pricingLogic: "Per seat", createdAt: new Date().toISOString() } as never],
      generatedAt: new Date("2026-09-23T00:00:00Z"),
      scopeLabel: "Approved pieces only",
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
    const text = buf.toString("latin1");
    expect(text).toContain("/Type /Page");
    expect(buf.subarray(-10).toString()).toContain("%%EOF");
  }, 60_000);
});
