/**
 * Claude, behind the provider-agnostic text interface (brief §05).
 *
 * Feature code never imports this file; the facade in ../index selects it from
 * config. Everything a caller could vary — model, effort, fallbacks, timeout —
 * arrives from the environment, so changing any of them is a config change.
 *
 * What the call does, and why:
 *
 *   - The system block (template + brand context) carries a cache breakpoint.
 *     It is identical for every draft in a workspace and format, so after the
 *     first call it is billed at cache-read rates instead of in full.
 *   - The reply is structured output: `{ variants: string[] }`. Asking for N
 *     variants in one call lets the model make them deliberately different,
 *     and returns them already separated, so nothing has to split prose on a
 *     guessed delimiter.
 *   - Server-side refusal fallbacks are on by default (`fallbacks: "default"`):
 *     a declined request is re-run on Anthropic's recommended model for that
 *     refusal category inside the same call. `result.model` reports the model
 *     that actually served it, which is what lands in generation_logs.
 *   - A refusal that survives the fallback, a truncated reply, or a reply that
 *     doesn't parse is an error, never an empty draft.
 *
 * Server-only.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ProviderError } from "../errors";
import type { StreamingTextProvider, StructuredResult, TextCallOptions, TextGenRequest, TextGenResult, TextImage, TextStreamEvent } from "../types";
import type { ZodType } from "zod";
import type { AssembledPrompt } from "../prompt";

/** Short-form social copy; generous enough that thinking never truncates it. */
const MAX_TOKENS = 16000;

/**
 * Temperature (audit M1), sent only when no thinking depth is configured. With
 * `effort` set the model may think, and a thinking request does not take a
 * custom temperature, so the parameter is left out and the model default applies.
 * Not verified against a live model here (no model calls in this change).
 */
function temperatureParam(opts: TextCallOptions): { temperature?: number } {
  return opts.temperature !== undefined && !opts.effort ? { temperature: opts.temperature } : {};
}

const Variants = z.object({ variants: z.array(z.string()) });

export interface AnthropicTextConfig {
  /** Server-side refusal fallbacks. "default" lets Anthropic route by category. */
  fallbacks: "default" | "off";
  timeoutMs: number;
  apiKey?: string;
}

/** The slice of the SDK this provider uses — narrow, so tests can stub it. */
export interface MessagesParser {
  beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"]; stream?: Anthropic["beta"]["messages"]["stream"] } };
}

function toProviderError(err: unknown): ProviderError {
  // The SDK has already retried 408/409/429/5xx and connection errors, so by
  // the time anything reaches here a further attempt is not worth making.
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new ProviderError("timeout", "The model did not answer in time.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("auth", "The Anthropic credentials were rejected. Check ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.RateLimitError) {
    const h = err.headers as unknown as { get?: (k: string) => string | null } | Record<string, string> | undefined;
    const retryAfter = typeof h?.get === "function" ? h.get("retry-after") : ((h as Record<string, string> | undefined)?.["retry-after"] ?? null);
    const seconds = Number(retryAfter);
    // Anthropic's limits are per minute; the wait it states is kept for the queue and the message.
    return new ProviderError("rate_limit", "The model is rate limited right now.", false, {
      window: "minute",
      ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: Math.ceil(seconds) } : {}),
    });
  }
  if (err instanceof Anthropic.BadRequestError)
    return new ProviderError("bad_request", `The model rejected the request: ${err.message}`);
  if (err instanceof Anthropic.InternalServerError)
    return new ProviderError("server", "The model service had an error.");
  if (err instanceof Anthropic.APIError)
    return new ProviderError("unknown", `Model call failed (${err.status ?? "no status"}): ${err.message}`);
  return new ProviderError("unknown", err instanceof Error ? err.message : String(err));
}

export function anthropicTextProvider(
  config: AnthropicTextConfig,
  client: MessagesParser = new Anthropic({
    // Unset falls through to the SDK's own resolution (ANTHROPIC_AUTH_TOKEN,
    // an `ant auth login` profile, workload identity).
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    timeout: config.timeoutMs,
  }),
): StreamingTextProvider {
  const provider: StreamingTextProvider = {
    name: "anthropic",

    /**
     * A draft written live. Plain text, not structured output: half a JSON
     * string can't be shown on a canvas. Same request shape as a task except
     * that no server-side fallback is used (see the call below), and the same
     * refusal and truncation checks, made on the final message once the
     * stream ends.
     */
    async *stream(req, model, opts = {}): AsyncIterable<TextStreamEvent> {
      if (!client.beta.messages.stream) throw new ProviderError("unknown", "This client cannot stream.");
      try {
        // No server-side fallback on a stream (audit H3, 2026-11-18). A fallback
        // re-runs the request on another model inside the same call, so the
        // deltas would show the discarded model's words while the saved text is
        // the kept one. A refusal here is an error the person can see and retry.
        const s = client.beta.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system: [{ type: "text", text: req.prompt.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: req.prompt.user }],
          ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
          ...temperatureParam(opts),
        });
        for await (const event of s) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "delta", text: event.delta.text };
          }
        }
        const msg = await s.finalMessage();
        if (msg.stop_reason === "refusal") {
          throw new ProviderError("refusal", `The model declined this request (${msg.stop_details?.category ?? "unspecified"}).`);
        }
        if (msg.stop_reason === "max_tokens") throw new ProviderError("truncated", "The reply was cut off before it finished.");
        const u = msg.usage;
        yield {
          type: "done",
          model: msg.model,
          tokensIn: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          tokensOut: u.output_tokens ?? 0,
          // Without a fallback the final message is exactly the streamed text;
          // the facade checks the two match before anything is saved.
          text:msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
        };
      } catch (err) {
        throw toProviderError(err);
      }
    },
    async generate(
      req: TextGenRequest & { prompt: AssembledPrompt },
      model: string,
      opts: TextCallOptions = {},
    ): Promise<TextGenResult> {
      const wanted = Math.max(1, req.variants ?? 1);
      const { data, served, tokensIn, tokensOut } = await call(req.prompt, model, Variants, opts);
      const variants = data.variants
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, wanted);
      if (variants.length === 0) {
        throw new ProviderError("unparseable", "The model's reply had no usable draft in it.");
      }
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
  return provider;

  /**
   * The user turn: plain text, or with pictures, each picture as a base64
   * image block followed by the text (Claude reads images before the question
   * best). The pictures are the caller's downscaled copies.
   */
  function userContent(prompt: AssembledPrompt, images: TextImage[] = []) {
    if (!images.length) return prompt.user;
    return [
      ...images.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mime, data: Buffer.from(img.data).toString("base64") },
      })),
      { type: "text" as const, text: prompt.user },
    ];
  }

  /**
   * One request shape for every call, so caching, fallbacks, effort and the
   * refusal / truncation / parse checks can never differ between a draft and
   * a task.
   */
  async function call<T>(prompt: AssembledPrompt, model: string, schema: ZodType<T>, opts: TextCallOptions, images: TextImage[] = []) {
      let res;
      try {
        res = await client.beta.messages.parse({
          model,
          max_tokens: MAX_TOKENS,
          ...(config.fallbacks === "default"
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
          system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userContent(prompt, images) }],
          output_config: {
            format: betaZodOutputFormat(schema),
            ...(opts.effort ? { effort: opts.effort } : {}),
          },
          ...temperatureParam(opts),
        });
      } catch (err) {
        throw toProviderError(err);
      }

      if (res.stop_reason === "refusal") {
        const category = res.stop_details?.category ?? "unspecified";
        throw new ProviderError("refusal", `The model declined this request (${category}).`);
      }
      if (res.stop_reason === "max_tokens") {
        throw new ProviderError("truncated", "The reply was cut off before it finished.");
      }

      // Validate again on our side: structured output shapes the reply, this
      // guarantees it, and a mismatch is a clear error rather than a crash
      // three functions later.
      const parsed = schema.safeParse(res.parsed_output);
      if (!parsed.success) {
        throw new ProviderError("unparseable", "The model's reply did not match the expected shape.");
      }

      const u = res.usage;
      return {
        data: parsed.data,
        // The model that SERVED it. Differs from `model` when a refusal
        // fallback ran, and the log should say which one actually wrote it.
        served: res.model,
        tokensIn:
          (u.input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0),
        tokensOut: u.output_tokens ?? 0,
      };
  }
}
