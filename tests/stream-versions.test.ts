/**
 * Audit H4 and L3 (2026-11-18), streamContent without a database:
 *   H4  a streamed draft whose version count is not the number asked for is
 *       written once more without streaming; if that is also the wrong count,
 *       nothing is saved and the person gets a plain message.
 *   L3  once the piece exists it is reported as saved, even when linking its
 *       generation log fails (the failure is logged).
 * The DB session, the AI facade, the template store and the logger are stubs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  again: { variants: [] as string[], model: "m-retry", logId: "log-2" as string | null },
  linkFails: false,
  sql: [] as string[],
  warn: [] as Array<[string, unknown]>,
  generateCalls: 0,
  linkCalls: [] as Array<[string | null | undefined, string]>,
}));

vi.mock("@/lib/ai", () => ({
  streamText: async function* () {
    for (const ev of st.events) yield ev;
  },
  generateText: async () => {
    st.generateCalls++;
    return st.again;
  },
  linkGeneration: async (_scope: unknown, logId: string | null | undefined, id: string) => {
    st.linkCalls.push([logId, id]);
    if (st.linkFails) throw new Error("link failed");
  },
  runTask: async () => {
    throw new Error("not used");
  },
}));
vi.mock("@/lib/ai/tasks", () => ({ rewritePart: {} }));
vi.mock("@/lib/ai/templates", () => ({
  resolveTemplate: async () => ({ id: null, key: "linkedin_post", version: 1, body: "system" }),
}));
vi.mock("@/lib/context/context-loader", async () => {
  const { buildBrandContext } = await import("@/lib/context/context-builder");
  return { loadBrandContext: async () => buildBrandContext({ brandProfile: { niche: "Leadership coaching" } }) };
});
vi.mock("@/lib/data/voice-pack", () => ({ recordOpener: async () => {} }));
vi.mock("@/lib/observability/log", () => ({
  logger: {
    warn: (msg: string, fields?: unknown) => st.warn.push([msg, fields]),
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));
vi.mock("@/db/session", () => ({
  withTenantSession: async (_scope: unknown, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string) => {
        st.sql.push(sql);
        return { rows: sql.includes("RETURNING id") ? [{ id: "11111111-1111-4111-8111-111111111111" }] : [], rowCount: 1 };
      },
    }),
}));

import { streamContent } from "@/lib/data/content";
import type { ProjectScope } from "@/lib/data/projects";

const scope = { tenantId: "22222222-2222-4222-8222-222222222222", userId: null, projectId: "33333333-3333-4333-8333-333333333333", isPlatformAdmin: false } as unknown as ProjectScope;
const input = { format: "linkedin_post", topic: "delegation" };
const SAVED = "11111111-1111-4111-8111-111111111111";

const delta = (text: string) => ({ type: "delta", text });
const done = (text: string) => ({ type: "done", text, model: "m-stream", tokensIn: 1, tokensOut: 1, logId: "log-1" });

async function collect() {
  const out: Array<Record<string, unknown>> = [];
  for await (const ev of streamContent(scope, input)) out.push(ev as Record<string, unknown>);
  return out;
}
const inserts = () => st.sql.filter((s) => s.includes("INSERT INTO content_generations")).length;

beforeEach(() => {
  st.events = [];
  st.again = { variants: [], model: "m-retry", logId: "log-2" };
  st.linkFails = false;
  st.sql = [];
  st.warn = [];
  st.generateCalls = 0;
  st.linkCalls = [];
});

describe("streamContent: the number of versions (audit H4)", () => {
  it("saves a draft whose separator is there, without a second call", async () => {
    st.events = [delta("Hook one\nBody one\n=====\nHook two\nBody two"), done("Hook one\nBody one\n=====\nHook two\nBody two")];
    const out = await collect();
    expect(out.at(-1)).toEqual({ type: "saved", id: SAVED });
    expect(out.some((e) => e.type === "replace")).toBe(false);
    expect(st.generateCalls).toBe(0);
    expect(inserts()).toBe(2);
    expect(st.linkCalls).toEqual([["log-1", SAVED]]);
  });

  it("writes the draft again without streaming when the separator went missing, shows that text, and saves it", async () => {
    const merged = "Hook one\nBody one\n\nHook two\nBody two";
    st.events = [delta(merged), done(merged)];
    st.again = { variants: ["Hook A\nBody A", "Hook B\nBody B"], model: "m-retry", logId: "log-2" };
    const out = await collect();
    expect(st.generateCalls).toBe(1);
    expect(out).toContainEqual({ type: "replace", text: "Hook A\nBody A\n=====\nHook B\nBody B" });
    expect(out.at(-1)).toEqual({ type: "saved", id: SAVED });
    expect(inserts()).toBe(2);
    // Both calls were logged, and both rows point at the piece.
    expect(st.linkCalls).toEqual([["log-1", SAVED], ["log-2", SAVED]]);
  });

  it("saves nothing and says so plainly when the second attempt is also the wrong count", async () => {
    st.events = [delta("Only one version"), done("Only one version")];
    st.again = { variants: ["Only one version"], model: "m-retry", logId: "log-2" };
    const run = collect();
    await expect(run).rejects.toThrow(/wrong number of versions/);
    expect(st.sql.some((s) => s.includes("INSERT INTO content_items"))).toBe(false);
    expect(inserts()).toBe(0);
  });
});

describe("streamContent: saved is reported even when linking fails (audit L3)", () => {
  it("still yields saved, and logs the link failure", async () => {
    st.events = [delta("Hook one\nBody\n=====\nHook two\nBody"), done("Hook one\nBody\n=====\nHook two\nBody")];
    st.linkFails = true;
    const out = await collect();
    expect(out.at(-1)).toEqual({ type: "saved", id: SAVED });
    expect(st.warn.map(([m]) => m)).toEqual(["generation_link_failed"]);
  });
});
