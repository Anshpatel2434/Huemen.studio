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
import type { StructuredResult, TextCallOptions, TextGenRequest, TextGenResult, TextProvider } from "../types";
import type { ZodType } from "zod";
import type { AssembledPrompt } from "../prompt";

/** Short-form social copy; generous enough that thinking never truncates it. */
const MAX_TOKENS = 16000;

const Variants = z.object({ variants: z.array(z.string()) });

export interface AnthropicTextConfig {
  /** Server-side refusal fallbacks. "default" lets Anthropic route by category. */
  fallbacks: "default" | "off";
  timeoutMs: number;
  apiKey?: string;
}

/** The slice of the SDK this provider uses — narrow, so tests can stub it. */
export interface MessagesParser {
  beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } };
}

function toProviderError(err: unknown): ProviderError {
  // The SDK has already retried 408/409/429/5xx and connection errors, so by
  // the time anything reaches here a further attempt is not worth making.
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new ProviderError("timeout", "The model did not answer in time.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("auth", "The Anthropic credentials were rejected. Check ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.RateLimitError)
    return new ProviderError("rate_limit", "The model is rate limited right now. Try again in a minute.");
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
): TextProvider {
  const provider: TextProvider = {
    name: "anthropic",
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
      const { data, served, tokensIn, tokensOut } = await call(req.prompt, model, schema, opts);
      return { data, model: served, tokensIn, tokensOut };
    },
  };
  return provider;

  /**
   * One request shape for every call, so caching, fallbacks, effort and the
   * refusal / truncation / parse checks can never differ between a draft and
   * a task.
   */
  async function call<T>(prompt: AssembledPrompt, model: string, schema: ZodType<T>, opts: TextCallOptions) {
      let res;
      try {
        res = await client.beta.messages.parse({
          model,
          max_tokens: MAX_TOKENS,
          ...(config.fallbacks === "default"
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
          system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: prompt.user }],
          output_config: {
            format: betaZodOutputFormat(schema),
            ...(opts.effort ? { effort: opts.effort } : {}),
          },
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
