/**
 * A comment asking to change a visual's words, refused because the rewrite
 * would add claims the brand facts don't back: the refusal lists the claims
 * the checker found (2026-11-18; it used to say only "That didn't work and was
 * logged"). The data layer is run with its database and the rewrite stood in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { refusedClaimsNote } from "@/lib/visual/refusal";
import { UnsupportedRewriteError } from "@/lib/voice/judge";
import type { UnsupportedClaim } from "@/lib/voice/facts";

const updates: unknown[][] = [];
vi.mock("@/db/session", () => ({
  withTenantSession: async (_scope: unknown, fn: (c: { query: (sql: string, args?: unknown[]) => Promise<{ rows: unknown[] }> }) => unknown) =>
    fn({
      query: async (sql: string, args: unknown[] = []) => {
        if (/^\s*UPDATE visual_comments/.test(sql)) updates.push(args);
        if (/SELECT hook, body, cta FROM content_items/.test(sql)) return { rows: [{ hook: "Clarity beats charisma.", body: "", cta: null }] };
        return { rows: [] };
      },
    }),
}));
const claims: UnsupportedClaim[] = [
  { kind: "number", excerpt: "I've helped 40 founders land it." },
  { kind: "event", excerpt: "Since my TEDx talk in 2019" },
];
vi.mock("@/lib/data/content", () => ({
  patchContent: vi.fn(),
  rewritePartOf: vi.fn(async () => { throw new UnsupportedRewriteError(claims, "I've helped 40 founders land it."); }),
}));

const { applyTemplateComment } = await import("@/lib/data/visual-comments");

describe("the refusal note", () => {
  it("lists each refused claim on its own line, quoted", () => {
    const note = refusedClaimsNote(claims);
    expect(note.split("\n")).toEqual([
      "Not changed. The rewrite would add claims that aren't in your brand facts:",
      "“I've helped 40 founders land it.”",
      "“Since my TEDx talk in 2019”",
      "If it's true, add it to your facts in Brand core; otherwise ask again without it.",
    ]);
  });
  it("keeps the list short: three at most, long ones clipped, the rest counted", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ kind: "number" as const, excerpt: `Claim ${i} ${"x".repeat(200)}` }));
    const lines = refusedClaimsNote(many).split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[4]).toBe("and 2 more");
    expect(lines[1].length).toBeLessThanOrEqual(92);
    expect(lines[1].endsWith("…”")).toBe(true);
  });
  it("one claim reads as one", () => {
    expect(refusedClaimsNote(claims.slice(0, 1))).toContain("add a claim that isn't in your brand facts:");
  });
});

describe("a refused text comment says which claims", () => {
  beforeEach(() => { updates.length = 0; });
  it("stores the claims as the comment's result, not a generic failure", async () => {
    const scope = { tenantId: "00000000-0000-0000-0000-00000000000a", projectId: "00000000-0000-0000-0000-00000000000b", userId: "u", isPlatformAdmin: false };
    const comment = {
      id: "c1", visualId: "v1", contentItemId: "i1", target: "headline" as const, box: { x: 0, y: 0, w: 1, h: 1 }, note: "Add a number",
      status: "open" as const, result: null, jobId: null, resultPictureId: null, createdAt: new Date().toISOString(),
    };
    await applyTemplateComment(scope as never, comment as never);
    const failed = updates.find((a) => a[1] === "failed");
    expect(failed, JSON.stringify(updates)).toBeTruthy();
    const result = String(failed![2]);
    expect(result).toContain("“I've helped 40 founders land it.”");
    expect(result).toContain("“Since my TEDx talk in 2019”");
    expect(result).not.toContain("didn't work and was logged");
  });
});
