/**
 * Groq, behind the same provider-agnostic text interface as Claude (brief §05).
 *
 * Groq serves open-weight models (gpt-oss, Qwen) on an OpenAI-compatible
 * chat API. Plain fetch, like the transcriber: three request shapes, and an
 * SDK would add a dependency for them. The fetch is injectable so tests never
 * touch the network.
 *
 *   - generate / structured: JSON output with the schema in the request
 *     (`response_format: json_schema`), then validated again with zod here.
 *     A reply that doesn't match is retried once, then is an error, never an
 *     empty draft.
 *   - stream: server-sent events; plain text, for drafts written live.
 *   - Effort maps to the model's reasoning effort (low / medium / high).
 *     Reasoning is not returned, only the answer.
 *
 * A structured task may carry pictures (`req.images`, vision): they go in the
 * user message as an OpenAI-style content array of base64 data URIs, and the
 * facade runs such a call on AI_VISION_MODEL.
 *
 * Groq draws no pictures: pictures stay on AI_IMAGE_PROVIDER. Voice notes can
 * use Groq's Whisper through the transcriber (AI_TRANSCRIBE_PROVIDER=groq).
 *
 * Server-only.
 */
import "server-only";
import { z } from "zod";
import type { ZodType } from "zod";
import { ProviderError, limitFrom } from "../errors";
import type { AssembledPrompt } from "../prompt";
import type { Effort, StreamingTextProvider, StructuredResult, TextCallOptions, TextGenRequest, TextGenResult, TextImage, TextStreamEvent } from "../types";

export const GROQ_BASE = "https://api.groq.com/openai/v1";
const MAX_TOKENS = 16000;
/** The longest stated rate-limit wait worth sitting out inside one request. */
const MAX_RATE_WAIT_S = 20;

const Variants = z.object({ variants: z.array(z.string()) });

export interface GroqTextConfig {
  apiKey: string;
  timeoutMs: number;
}

export type GroqFetch = (url: string, init: RequestInit) => Promise<Response>;

interface ChatReply {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const reasoning = (e?: Effort) => (e ? (e === "low" ? "low" : e === "medium" ? "medium" : "high") : undefined);

function statusError(status: number, detail: string, retryAfter: string | null = null): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("auth", "The Groq credentials were rejected. Check GROQ_API_KEY.");
  // Not retried: a second call 200 ms into a rate limit only doubles the traffic
  // against it. Server errors and timeouts get the facade's one retry (no SDK
  // has retried them here). Which limit was hit (per minute or per day) and
  // when it frees up are kept, so the person and the job queue can tell a
  // short wait from a long one (2026-11-18 new-account run).
  if (status === 429) {
    const limit = limitFrom(detail, retryAfter);
    const which = limit.window === "day" ? "daily" : limit.window === "minute" ? "per-minute" : "a";
    return new ProviderError("rate_limit", `Groq hit ${which} rate limit${limit.retryAfterSeconds ? `; retry in ${limit.retryAfterSeconds}s` : ""}.`, false, limit);
  }
  if (status >= 500) return new ProviderError("server", "The model service had an error.", true);
  return new ProviderError("bad_request", `The model rejected the request: ${detail.slice(0, 300)}`);
}

function fetchError(e: unknown): ProviderError {
  const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
  return timedOut
    ? new ProviderError("timeout", "The model did not answer in time.", true)
    : new ProviderError("unknown", `Model call failed: ${e instanceof Error ? e.message : String(e)}`, true);
}

/** The schema as JSON Schema for the request; the zod parse afterwards is the guarantee. */
function jsonSchemaOf(schema: ZodType<unknown>): Record<string, unknown> {
  try {
    const js = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
    delete js.$schema;
    return js;
  } catch {
    return { type: "object" };
  }
}

export function groqTextProvider(config: GroqTextConfig, fetchImpl: GroqFetch = fetch): StreamingTextProvider {
  const headers = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };

  /**
   * One call. A rate limit that says when to come back, and soon (Groq sends
   * `retry-after` in seconds), is waited out once: back-to-back calls such as
   * onboarding's pillars, topics and first draft otherwise fail on the second
   * call (2026-11-17 round-two test). A longer wait, or a second refusal, is
   * the plain "rate limited" error, never a blind immediate retry.
   */
  async function post(body: Record<string, unknown>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (e) {
        throw fetchError(e);
      }
      if (res.ok) return res;
      const wait = Number(res.headers.get("retry-after"));
      if (res.status === 429 && attempt === 0 && Number.isFinite(wait) && wait > 0 && wait <= MAX_RATE_WAIT_S) {
        await res.text().catch(() => "");
        await new Promise((r) => setTimeout(r, Math.ceil(wait * 1000) + 250));
        continue;
      }
      throw statusError(res.status, await res.text().catch(() => ""), res.headers.get("retry-after"));
    }
  }

  const base = (prompt: AssembledPrompt, model: string, opts: TextCallOptions, images: TextImage[] = []) => ({
    model,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: prompt.system },
      // With pictures, the OpenAI-style content array: the text, then each
      // picture as a data URI (Groq's vision models take base64 inline).
      { role: "user", content: images.length ? [{ type: "text", text: prompt.user }, ...images.map(imagePart)] : prompt.user },
    ],
    ...(reasoning(opts.effort) ? { reasoning_effort: reasoning(opts.effort) } : {}),
    // Sent only when the facade chose one (audit M1); a rerun of a judgement or rewrite then gives the same answer.
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    include_reasoning: false,
  });

  async function call<T>(prompt: AssembledPrompt, model: string, schema: ZodType<T>, opts: TextCallOptions, images: TextImage[] = []) {
    const shape = jsonSchemaOf(schema as ZodType<unknown>);
    let lastErr: ProviderError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await post({
        ...base(
          {
            system: prompt.system,
            user: `${prompt.user}\n\nReply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(shape)}`,
          } as AssembledPrompt,
          model,
          opts,
          images,
        ),
        response_format: { type: "json_schema", json_schema: { name: "reply", schema: shape, strict: false } },
      });
      const reply = (await res.json().catch(() => null)) as ChatReply | null;
      const choice = reply?.choices?.[0];
      if (choice?.finish_reason === "length") throw new ProviderError("truncated", "The reply was cut off before it finished.");
      const text = choice?.message?.content ?? "";
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        lastErr = new ProviderError("unparseable", "The model's reply was not valid JSON.");
        continue;
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        lastErr = new ProviderError("unparseable", "The model's reply did not match the expected shape.");
        continue;
      }
      return {
        data: parsed.data,
        served: reply?.model ?? model,
        tokensIn: reply?.usage?.prompt_tokens ?? 0,
        tokensOut: reply?.usage?.completion_tokens ?? 0,
      };
    }
    throw lastErr ?? new ProviderError("unparseable", "The model's reply did not match the expected shape.");
  }

  return {
    name: "groq",

    async *stream(req, model, opts = {}): AsyncIterable<TextStreamEvent> {
      const res = await post({ ...base(req.prompt, model, opts), stream: true, stream_options: { include_usage: true } });
      if (!res.body) throw new ProviderError("unknown", "The stream had no body.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      let served = model;
      let tokensIn = 0;
      let tokensOut = 0;
      let finish: string | undefined;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            let ev: ChatReply & { choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]; x_groq?: { usage?: ChatReply["usage"] } };
            try {
              ev = JSON.parse(data);
            } catch {
              continue;
            }
            if (ev.model) served = ev.model;
            const usage = ev.usage ?? ev.x_groq?.usage;
            if (usage) {
              tokensIn = usage.prompt_tokens ?? tokensIn;
              tokensOut = usage.completion_tokens ?? tokensOut;
            }
            const c = ev.choices?.[0];
            if (c?.finish_reason) finish = c.finish_reason;
            const delta = c?.delta?.content;
            if (delta) {
              text += delta;
              yield { type: "delta", text: delta };
            }
          }
        }
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        throw fetchError(e);
      }
      // Only a reply the model finished ("stop") is saved. A cut-off reply, a
      // filtered one, or a stream that simply ended is an error, never a draft
      // that looks complete (audit C1, 2026-11-18).
      if (finish === "length") throw new ProviderError("truncated", "The reply was cut off before it finished.");
      if (finish === "content_filter") throw new ProviderError("refusal", "The model declined this request (content filter).");
      if (finish !== "stop") throw new ProviderError("truncated", "The reply stopped before it finished. Try again.", true);
      if (!text.trim()) throw new ProviderError("unparseable", "The model returned no text.");
      yield { type: "done", model: served, tokensIn, tokensOut, text };
    },

    async generate(req: TextGenRequest & { prompt: AssembledPrompt }, model: string, opts: TextCallOptions = {}): Promise<TextGenResult> {
      const wanted = Math.max(1, req.variants ?? 1);
      // Open models follow the count better when it is stated next to the format.
      const prompt = wanted > 1 ? { ...req.prompt, user: `${req.prompt.user}

Return exactly ${wanted} clearly different versions in "variants".` } : req.prompt;
      const { data, served, tokensIn, tokensOut } = await call(prompt, model, Variants, opts);
      const variants = data.variants.map((v) => v.trim()).filter(Boolean).slice(0, wanted);
      if (variants.length === 0) throw new ProviderError("unparseable", "The model's reply had no usable draft in it.");
      return { variants, model: served, tokensIn, tokensOut };
    },

    async structured<T>(
      req: TextGenRequest & { prompt: AssembledPrompt },
      model: string,
      schema: ZodType<T>,
      opts: TextCallOptions = {},
    ): Promise<StructuredResult<T>> {
      const { data, served, tokensIn, tokensOut } = await call(req.prompt, model, schema, opts, req.images);
      return { data, model: served, tokensIn, tokensOut };
    },
  };
}

/** One picture as an OpenAI-style content part (a base64 data URI). */
function imagePart(img: TextImage) {
  return { type: "image_url", image_url: { url: `data:${img.mime};base64,${Buffer.from(img.data).toString("base64")}` } };
}
