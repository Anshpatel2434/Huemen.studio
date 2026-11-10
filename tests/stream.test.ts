/**
 * Drafts written live (brief §07). Three layers:
 *   - the stream contract and its reader (STREAM_SEPARATOR, splitStreamed)
 *   - the Anthropic provider's stream, against a stub of the SDK's stream
 *   - streamContent end to end on the stand-in: deltas add up to what is
 *     saved, the piece lands with both versions, the call is logged, the cap
 *     still stops it, and another tenant sees none of it (INV-1)
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { assemblePrompt, splitStreamed, STREAM_SEPARATOR } from "@/lib/ai/prompt";
import { anthropicTextProvider, type MessagesParser } from "@/lib/ai/providers/anthropic";
import { mockTextProvider } from "@/lib/ai/providers/mock";
import { buildBrandContext } from "@/lib/context/context-builder";
import { ProviderError, UsageCapError } from "@/lib/ai/errors";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { createProject, type ProjectScope } from "@/lib/data/projects";
import { listContent, streamContent } from "@/lib/data/content";
import { loadUsage } from "@/lib/data/insights";

const context = buildBrandContext({ brandProfile: { niche: "Leadership coaching" } });
const prompt = assemblePrompt("You write LinkedIn posts.", context, "Format: LinkedIn post\nTopic: delegation", {
  templateKey: "linkedin_post",
  variants: 2,
  stream: true,
});

describe("the stream contract", () => {
  it("asks for plain text with the separator, never JSON", () => {
    expect(prompt.user).toContain(`a line containing only ${STREAM_SEPARATOR}`);
    expect(prompt.user).toMatch(/No JSON/);
  });
  it("reads versions back, ignoring blank versions and stray spaces", () => {
    expect(splitStreamed(`Hook one\nBody\n  ${STREAM_SEPARATOR}  \nHook two\nBody two\n${STREAM_SEPARATOR}\n\n`)).toEqual([
      "Hook one\nBody",
      "Hook two\nBody two",
    ]);
  });
});

describe("the stand-in streams what it would have returned", () => {
  it("deltas join to the same two drafts generate() gives", async () => {
    const req = { templateKey: "linkedin_post", context, taskInput: "Format: LinkedIn post\nTopic: delegation", variants: 2, prompt };
    const whole = await mockTextProvider.generate(req, "mock-strong");
    let text = "";
    let deltas = 0;
    let done = false;
    for await (const ev of mockTextProvider.stream(req, "mock-strong")) {
      if (ev.type === "delta") { text += ev.text; deltas++; } else done = true;
    }
    expect(done).toBe(true);
    expect(deltas).toBeGreaterThan(10);
    expect(splitStreamed(text)).toEqual(whole.variants.map((v) => v.trim()));
  });
});

describe("the Anthropic provider's stream", () => {
  function stub(events: unknown[], final: Record<string, unknown>) {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          parse: async () => { throw new Error("not used"); },
          stream: (params: Record<string, unknown>) => {
            calls.push(params);
            return {
              async *[Symbol.asyncIterator]() { for (const e of events) yield e; },
              finalMessage: async () => final,
            };
          },
        },
      },
    } as unknown as MessagesParser;
    return { client, calls };
  }
  const delta = (text: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 900, output_tokens: 40 };

  it("sends the cached system block with fallbacks, yields text deltas, and reports the final text", async () => {
    const { client, calls } = stub([delta("Hook\n"), delta("Body")], {
      model: "claude-opus-5-5", stop_reason: "end_turn", usage, content: [{ type: "text", text: "Hook\nBody" }],
    });
    const p = anthropicTextProvider({ fallbacks: "default", timeoutMs: 1000 }, client);
    const out: unknown[] = [];
    for await (const ev of p.stream({ templateKey: "linkedin_post", context, taskInput: "", prompt }, "claude-opus-5-5", { effort: "medium" })) out.push(ev);
    expect(out).toEqual([
      { type: "delta", text: "Hook\n" },
      { type: "delta", text: "Body" },
      { type: "done", model: "claude-opus-5-5", tokensIn: 910, tokensOut: 40, text: "Hook\nBody" },
    ]);
    const sent = calls[0] as { system: { cache_control: unknown }[]; fallbacks: string; betas: string[]; output_config: { effort: string } };
    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sent.fallbacks).toBe("default");
    expect(sent.betas).toContain("server-side-fallback-2026-07-01");
    expect(sent.output_config.effort).toBe("medium");
  });

  it("a refusal at the end is an error, never an empty draft", async () => {
    const { client } = stub([delta("Partial")], { model: "m", stop_reason: "refusal", stop_details: { category: "cyber" }, usage, content: [] });
    const p = anthropicTextProvider({ fallbacks: "off", timeoutMs: 1000 }, client);
    const run = async () => { for await (const _ of p.stream({ templateKey: "x", context, taskInput: "", prompt }, "m")) void _; };
    await expect(run()).rejects.toBeInstanceOf(ProviderError);
  });
});

// ---------------------------------------------------------------- end to end

let dbReachable = false;
let A: ProjectScope;
let B: ProjectScope;

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const mk = (name: string) =>
    withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) =>
      (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id,
    );
  const [ta, tb] = [await mk("Stream A (test)"), await mk("Stream B (test)")];
  const wa = { tenantId: ta, userId: null, isPlatformAdmin: false };
  const wb = { tenantId: tb, userId: null, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "A") };
  B = { ...wb, projectId: await createProject(wb, "B") };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]),
  );
  await appPool().end();
});

describe("streamContent", () => {
  it("saves what it streamed, both versions in history, logged once, invisible to another tenant", async () => {
    if (!dbReachable) return;
    let text = "";
    let id = "";
    for await (const ev of streamContent(A, { format: "linkedin_post", topic: "delegation" })) {
      if (ev.type === "delta") text += ev.text;
      else id = ev.id;
    }
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const item = (await listContent(A)).find((c) => c.id === id)!;
    expect(text.startsWith(item.hook)).toBe(true);
    expect(item.history.length).toBe(2);
    expect((await loadUsage(A)).textThisMonth).toBe(1);
    expect(await listContent(B)).toEqual([]);
  });

  it("the hard cap stops a stream before anything is written", async () => {
    if (!dbReachable) return;
    await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
      c.query("INSERT INTO tenant_usage_caps (tenant_id, monthly_text_hard) VALUES ($1, 1)", [A.tenantId]),
    );
    const deltas: string[] = [];
    const run = async () => { for await (const ev of streamContent(A, { format: "linkedin_post", topic: "again" })) if (ev.type === "delta") deltas.push(ev.text); };
    await expect(run()).rejects.toBeInstanceOf(UsageCapError);
    expect(deltas).toEqual([]);
    expect((await listContent(A)).length).toBe(1);
  });
});
