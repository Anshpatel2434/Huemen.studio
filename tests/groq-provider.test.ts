import { describe, expect, it } from "vitest";
import { z } from "zod";
import { groqTextProvider, type GroqFetch } from "@/lib/ai/providers/groq";
import { ProviderError, limitFrom, parseWait, userMessage } from "@/lib/ai/errors";

const prompt = { system: "sys", user: "user" };
const reply = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ model: "m-served", choices: [{ message: { content }, finish_reason: "stop", ...extra }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

function fake(...responses: (Response | Error)[]) {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const f: GroqFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).Authorization) });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r ?? new Response("{}", { status: 500 });
  };
  return { f, calls };
}

describe("groq text provider", () => {
  it("asks for the variants as JSON and returns them with usage and the serving model", async () => {
    const { f, calls } = fake(reply(JSON.stringify({ variants: [" one ", "two", "three"] })));
    const p = groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, f);
    const out = await p.generate({ prompt, variants: 2 } as never, "openai/gpt-oss-120b", { effort: "xhigh" });
    expect(out).toEqual({ variants: ["one", "two"], model: "m-served", tokensIn: 10, tokensOut: 5 });
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer k");
    expect(calls[0].body.reasoning_effort).toBe("high");
    expect((calls[0].body.response_format as { type: string }).type).toBe("json_schema");
    expect(String((calls[0].body.messages as { content: string }[])[1].content)).toContain("exactly 2");
  });

  it("retries once when the reply does not match the schema, then fails clearly", async () => {
    const schema = z.object({ hooks: z.array(z.string()) });
    const ok = fake(reply("not json"), reply(JSON.stringify({ hooks: ["a"] })));
    const p = groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, ok.f);
    expect((await p.structured({ prompt } as never, "m", schema)).data).toEqual({ hooks: ["a"] });
    expect(ok.calls).toHaveLength(2);

    const bad = fake(reply(JSON.stringify({ nope: 1 })), reply(JSON.stringify({ nope: 2 })));
    await expect(groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, bad.f).structured({ prompt } as never, "m", schema)).rejects.toMatchObject({ kind: "unparseable" });
  });

  it("maps HTTP failures to retryable or final provider errors", async () => {
    const cases: [number, string, boolean][] = [[401, "auth", false], [429, "rate_limit", false], [503, "server", true], [400, "bad_request", false]];
    for (const [status, kind, retryable] of cases) {
      const { f } = fake(new Response("x", { status }));
      const err = await groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, f).generate({ prompt } as never, "m").catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toMatchObject({ kind, retryable });
    }
  });

  it("waits out a short stated rate limit once, and gives up on a long one", async () => {
    const ok = fake(new Response("x", { status: 429, headers: { "retry-after": "0.01" } }), reply(JSON.stringify({ variants: ["a"] })));
    expect((await groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, ok.f).generate({ prompt } as never, "m")).variants).toEqual(["a"]);
    expect(ok.calls).toHaveLength(2);
    const long = fake(new Response("x", { status: 429, headers: { "retry-after": "90" } }), reply(JSON.stringify({ variants: ["a"] })));
    await expect(groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, long.f).generate({ prompt } as never, "m")).rejects.toMatchObject({ kind: "rate_limit" });
    expect(long.calls).toHaveLength(1);
    const twice = fake(new Response("x", { status: 429, headers: { "retry-after": "0.01" } }), new Response("x", { status: 429, headers: { "retry-after": "0.01" } }));
    await expect(groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, twice.f).generate({ prompt } as never, "m")).rejects.toMatchObject({ kind: "rate_limit" });
    expect(twice.calls).toHaveLength(2);
  });

  it("tells a daily limit from a per-minute one and keeps when it frees up", async () => {
    const body = (msg: string) => JSON.stringify({ error: { message: msg, type: "tokens", code: "rate_limit_exceeded" } });
    const day = fake(new Response(body("Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199616, Requested 2392. Please try again in 14m27.5712s. Need more tokens?"), { status: 429 }));
    const e1 = await groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, day.f).generate({ prompt } as never, "m").catch((e) => e);
    expect(e1).toMatchObject({ kind: "rate_limit", limit: { window: "day", retryAfterSeconds: 868 } });
    expect(userMessage(e1)).toContain("daily allowance");
    expect(userMessage(e1)).toContain("about 14 minutes");

    const minute = fake(new Response(body("Rate limit reached ... on tokens per minute (TPM): Limit 8000, Used 7900, Requested 900. Please try again in 6.75s."), { status: 429, headers: { "retry-after": "90" } }));
    const e2 = await groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, minute.f).generate({ prompt } as never, "m").catch((e) => e);
    expect(e2).toMatchObject({ kind: "rate_limit", limit: { window: "minute", retryAfterSeconds: 7 } });
    expect(userMessage(e2)).toBe("Too many requests this minute. Try again in a few seconds.");
  });

  it("reads Groq's wait strings", () => {
    expect(parseWait("Please try again in 1h2m3s.")).toBe(3723);
    expect(parseWait("try again in 250ms")).toBe(1);
    expect(parseWait("no wait here")).toBeUndefined();
    expect(limitFrom("x", "30")).toEqual({ retryAfterSeconds: 30 });
    expect(limitFrom("requests per day (RPD)", null)).toEqual({ window: "day" });
  });

  it("treats a cut-off reply as truncated, never as an empty draft", async () => {
    const { f } = fake(reply('{"variants":["half', { finish_reason: "length" }));
    await expect(groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, f).generate({ prompt } as never, "m")).rejects.toMatchObject({ kind: "truncated" });
  });

  it("streams deltas and finishes with the whole text and usage", async () => {
    const sse = [
      { model: "m-s", choices: [{ delta: { content: "Hello " } }] },
      { choices: [{ delta: { content: "world" }, finish_reason: "stop" }] },
      { choices: [], x_groq: { usage: { prompt_tokens: 7, completion_tokens: 2 } } },
    ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
    const { f, calls } = fake(new Response(sse, { status: 200 }));
    const events = [];
    for await (const ev of groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, f).stream({ prompt } as never, "m")) events.push(ev);
    expect(calls[0].body.stream).toBe(true);
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("Hello world");
    expect(events.at(-1)).toEqual({ type: "done", model: "m-s", tokensIn: 7, tokensOut: 2, text: "Hello world" });
  });
});

describe("groq stream completion (audit C1)", () => {
  const sseOf = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200 });
  const collect = async (res: Response) => {
    const out: unknown[] = [];
    for await (const ev of groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, async () => res).stream({ prompt } as never, "m")) out.push(ev);
    return out;
  };
  it("refuses a stream that ends without a finish reason", async () => {
    await expect(collect(sseOf([{ choices: [{ delta: { content: "Half a draft" } }] }]))).rejects.toMatchObject({ kind: "truncated" });
  });
  it("refuses a filtered stream", async () => {
    await expect(collect(sseOf([{ choices: [{ delta: { content: "x" }, finish_reason: "content_filter" }] }]))).rejects.toMatchObject({ kind: "refusal" });
  });
});
