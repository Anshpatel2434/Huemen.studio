/**
 * Small Content-area fixes, 2026-11-18 (log: D:\huemen-recordings\2026-11-18\fixes\small-content.md).
 * Pure helpers only: no database, no model.
 */
import { describe, expect, it } from "vitest";
import { carryOnModeSwitch } from "@/app/w/[id]/p/[pid]/content/mode-switch";
import { previewFrameOf } from "@/app/w/[id]/p/[pid]/content/preview-frame";
import { refusedClaims } from "@/app/w/[id]/check/refused";
import { guideClosedKey, guideOpensItself, shouldShowGuide } from "@/app/w/[id]/(home)/guide-open";
import { inviteLink, workspaceBaseUrl } from "@/lib/invite/link";
import { exportVoiceFile } from "@/lib/voice/export";
import { FORMATS } from "@/lib/content/formats";
import { emptyIndex, type VoicePack } from "@/lib/voice/types";

describe("1. switching how to write a piece keeps what was typed", () => {
  it("the topic carries into I'll write it when the piece box is empty", () => {
    expect(carryOnModeSwitch("ghostwrite", "check", { brief: "Pricing your first offer", text: "" }))
      .toEqual({ brief: "Pricing your first offer", text: "Pricing your first offer" });
  });
  it("a piece already written is never replaced by the topic", () => {
    expect(carryOnModeSwitch("ghostwrite", "check", { brief: "Topic", text: "My own draft" }).text).toBe("My own draft");
  });
  it("back to drafting keeps the topic, and fills an empty one from the piece's first line", () => {
    expect(carryOnModeSwitch("check", "ghostwrite", { brief: "Topic", text: "Hook line\nbody" })).toEqual({ brief: "Topic", text: "Hook line\nbody" });
    expect(carryOnModeSwitch("check", "cowrite", { brief: "  ", text: "\n Hook line \nbody" }).brief).toBe("Hook line");
  });
  it("between the two drafting modes nothing moves", () => {
    expect(carryOnModeSwitch("ghostwrite", "cowrite", { brief: "Topic", text: "" })).toEqual({ brief: "Topic", text: "" });
  });
});

describe("3. each format previews in its own platform's frame", () => {
  it("Instagram formats get the Instagram frame, not LinkedIn's", () => {
    expect(previewFrameOf("ig_carousel")).toBe("instagram");
    expect(previewFrameOf("ig_caption")).toBe("instagram");
  });
  it("only LinkedIn posts get LinkedIn chrome", () => {
    const linkedin = FORMATS.filter((f) => previewFrameOf(f.key) === "linkedin").map((f) => f.key);
    expect(linkedin.sort()).toEqual(["hook_set", "linkedin_post"]);
    expect(previewFrameOf("x_post")).toBe("x");
    expect(previewFrameOf("threads_post")).toBe("threads");
    expect(previewFrameOf("whatsapp_message")).toBe("message");
    expect(previewFrameOf("pitch_email")).toBe("email");
    expect(previewFrameOf("talk_abstract")).toBe("neutral");
    expect(previewFrameOf("linkedin_comment")).toBe("neutral");
    expect(previewFrameOf("no_such_format")).toBe("neutral");
  });
});

describe("4. the Check rewrite says which claims it left out", () => {
  const issues = [
    { code: "unsupported_claim", excerpt: "We grew 312% in a month." },
    { code: "unsupported_claim", excerpt: "As Naval says, read more…" },
    { code: "hashtags", excerpt: "#growth" },
    { code: "unsupported_claim", excerpt: "Kept in the rewrite." },
  ];
  const before = "We grew 312% in a month. As Naval says, read more books. Kept in the rewrite. #growth";
  it("lists flagged claims that are gone from the rewrite, and only those", () => {
    expect(refusedClaims(issues, before, "Growth is slow. Kept in the rewrite.")).toEqual(["We grew 312% in a month.", "As Naval says, read more…"]);
  });
  it("nothing when the claims stayed, or the check flagged none", () => {
    expect(refusedClaims(issues, before, before)).toEqual([]);
    expect(refusedClaims([], before, "x")).toEqual([]);
  });
  it("a claim no longer in the draft that was rewritten is not listed", () => {
    expect(refusedClaims(issues, "Kept in the rewrite.", "Something else.")).toEqual(["Kept in the rewrite."]);
  });
});

describe("5. Getting started stays closed once closed", () => {
  it("the server opens it only until it has been seen", () => {
    expect(guideOpensItself(undefined)).toBe(true);
    expect(guideOpensItself("2026-11-18T10:00:00Z")).toBe(false);
  });
  it("a close kept in this tab cancels an auto-open, never the person's own open", () => {
    expect(shouldShowGuide("auto", false)).toBe(true);
    expect(shouldShowGuide("auto", true)).toBe(false);
    expect(shouldShowGuide("open", true)).toBe(true);
    expect(shouldShowGuide("closed", false)).toBe(false);
    expect(guideClosedKey("t1")).not.toBe(guideClosedKey("t2"));
  });
});

describe("7. the exported guardrails carry no placeholder", () => {
  const pack = (identity: VoicePack["identity"] = {}): VoicePack => ({
    id: "p1", userId: "u1", slug: "riya", displayName: "Riya", status: "active", version: 1,
    voiceLine: "", hardRules: [], identity, guardrails: [], mechanics: {}, contexts: {}, redPen: {}, index: emptyIndex(),
    corpusStats: { pieces: 0, words: 0, sentences: 0, channels: [] }, scannedAt: null,
    onboarding: {}, workMode: "ghostwrite", topicSuggestions: [], topicsGeneratedAt: null,
  });
  it("no [placeholder] in guardrails.md, with or without proofs", () => {
    const bare = exportVoiceFile("guardrails.md", pack(), []);
    expect(bare).not.toMatch(/placeholder/i);
    expect(bare).toContain("Write the line without the fact");
  });
  it("names the facts they can stand behind, from the pack", () => {
    const md = exportVoiceFile("guardrails.md", pack({ proofs: { value: [{ claim: "40 founders coached", source: "client list, 2025" }], confidence: "stated", source: "ask" } as never }), []);
    expect(md).toContain("“40 founders coached” (client list, 2025)");
    expect(md).not.toMatch(/placeholder/i);
  });
});

describe("8. invite links use the workspace's own host", () => {
  const APP = "http://localhost:3120";
  it("falls back to the app URL when the workspace has no host", () => {
    expect(workspaceBaseUrl(APP, null)).toBe(APP);
    expect(workspaceBaseUrl(`${APP}/`, "")).toBe(APP);
    expect(inviteLink(APP, undefined, "tok")).toBe(`${APP}/invite/tok`);
  });
  it("a local workspace host keeps the app's scheme and port", () => {
    expect(workspaceBaseUrl(APP, "new-client.localhost:3120")).toBe("http://new-client.localhost:3120");
    expect(workspaceBaseUrl(APP, "new-client.localhost")).toBe("http://new-client.localhost:3120");
    expect(inviteLink(APP, "New-Client.localhost:3120", "tok")).toBe("http://new-client.localhost:3120/invite/tok");
  });
  it("a real domain is https", () => {
    expect(workspaceBaseUrl(APP, "studio.example.com")).toBe("https://studio.example.com");
    expect(workspaceBaseUrl("https://app.huemen.studio", "https://brand.example.co.uk/")).toBe("https://brand.example.co.uk");
  });
  it("anything that is not a bare host falls back to the app URL", () => {
    for (const bad of ["evil.com/path", "user@evil.com", "a b.com", "evil.com:99999", "-bad.com", "javascript:alert(1)"]) {
      expect(workspaceBaseUrl(APP, bad), bad).toBe(APP);
    }
  });
});
