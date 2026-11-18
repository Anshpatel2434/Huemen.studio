import { describe, expect, it } from "vitest";
import { assemblePrompt } from "./prompt";
import type { BrandContext } from "@/lib/context/context-builder";

const ctx = { serialized: "BRAND CONTEXT", writing: undefined } as unknown as BrandContext;
const contract = (templateKey: string, stream = false) =>
  assemblePrompt("TEMPLATE", ctx, "Format: x", { templateKey, variants: 2, stream }).user;

describe("format contracts (lib/ai/prompt)", () => {
  it("X post states the 280 character limit the check enforces", () => {
    const c = contract("x_post");
    expect(c).toContain("at most 280 characters");
    expect(c).not.toContain("The first line is the hook");
  });

  it("X post keeps the limit in a streamed draft too", () => {
    expect(contract("x_post", true)).toContain("at most 280 characters");
  });

  it("LinkedIn comment is a reply to someone else's post, not a post", () => {
    const c = contract("linkedin_comment");
    expect(c).toContain("a comment on someone else's LinkedIn post");
    expect(c).toContain("No headline");
    expect(c).not.toContain("The first line is the hook");
  });

  it("WhatsApp message has a message shape and forbids narration", () => {
    const c = contract("whatsapp_message");
    expect(c).toContain("the message itself");
    expect(c).toContain("Never narrate it");
    expect(c).toContain("first person");
  });

  it("the hook set keeps its five-line shape", () => {
    expect(contract("linkedin_hook_set")).toContain("exactly five opening lines");
  });

  it("a LinkedIn post keeps the default hook, body and call to action shape", () => {
    expect(contract("linkedin_post")).toContain("The first line is the hook.");
  });
});
