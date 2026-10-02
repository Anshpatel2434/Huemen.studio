/**
 * AI facade (brief §05). Feature code calls THIS — never a concrete provider.
 *
 * Responsibilities:
 *   - Assemble every prompt as: system template + brand context block + task
 *     input (INV-2). No module assembles context itself.
 *   - Select provider + model from CONFIG (env), never hardcoded.
 *   - Apply retry/fallback ONCE here, so a provider hiccup is not a broken screen.
 *   - Write a generation_logs row for EVERY call before returning — no silent
 *     failures; a failure is a logged, retryable state.
 *
 * Server-only.
 */
import "server-only";
import { getEnv } from "@/lib/env";
import { withTenantSession, type SessionScope } from "@/db/session";
import type {
  ImageGenRequest,
  ImageProvider,
  TextGenRequest,
  TextProvider,
} from "./types";
import { mockImageProvider, mockTextProvider } from "./providers/mock";
import { anthropicTextProvider } from "./providers/anthropic";
import { openaiTranscriber, type FetchLike, type Transcriber } from "./providers/openai-transcribe";
import { assemblePrompt } from "./prompt";
import { AiConfigError, ProviderError } from "./errors";
import type { Env } from "@/lib/env";
import type { Effort, TextRoute } from "./types";
import type { TaskDef } from "./tasks";
import { resolveTemplate } from "./templates";
import type { BrandContext } from "@/lib/context/context-builder";

export { assemblePrompt } from "./prompt";

/*
 * Provider selection is EXHAUSTIVE. There is no `default:` branch that quietly
 * hands back the stand-in: choosing a provider that isn't built is a loud
 * configuration error on the first call. Before this, AI_TEXT_PROVIDER=openai
 * silently produced mock copy — a deployment that looked configured and wasn't.
 */
let _anthropic: TextProvider | null = null;

export function selectTextProvider(env: Env): TextProvider {
  switch (env.AI_TEXT_PROVIDER) {
    case "mock":
      return mockTextProvider;
    case "anthropic":
      _anthropic ??= anthropicTextProvider({
        fallbacks: env.AI_TEXT_FALLBACKS,
        timeoutMs: env.AI_TEXT_TIMEOUT_MS,
        apiKey: env.ANTHROPIC_API_KEY || undefined,
      });
      return _anthropic;
    case "openai":
      throw new AiConfigError(
        'AI_TEXT_PROVIDER=openai is not built. Use "anthropic", or "mock" for local development.',
      );
  }
}

export function selectImageProvider(env: Env): ImageProvider {
  switch (env.AI_IMAGE_PROVIDER) {
    case "mock":
      return mockImageProvider;
    case "openai":
    case "replicate":
      // Visuals are templated by design (brief §09: image models misspell
      // text), so no image model is wired. Say so instead of faking one.
      throw new AiConfigError(
        `AI_IMAGE_PROVIDER=${env.AI_IMAGE_PROVIDER} is not built. Visuals are rendered from templates; use "mock".`,
      );
  }
}

/**
 * The model for a route. The stand-in may name itself; a real provider must be
 * told which model to use, because model choice is config and never a default
 * buried in code (brief §05).
 */
export function resolveTextModel(env: Env, route: TextRoute): string {
  const configured = route === "cheap" ? env.AI_TEXT_MODEL_CHEAP : env.AI_TEXT_MODEL_STRONG;
  if (configured) return configured;
  if (env.AI_TEXT_PROVIDER === "mock") return `mock-${route}`;
  throw new AiConfigError(
    `${route === "cheap" ? "AI_TEXT_MODEL_CHEAP" : "AI_TEXT_MODEL_STRONG"} is not set. ` +
      `Name a model for the ${route} route in .env (see .env.example).`,
  );
}

function resolveEffort(env: Env, route: TextRoute): Effort | undefined {
  return route === "cheap" ? env.AI_TEXT_EFFORT_CHEAP : env.AI_TEXT_EFFORT_STRONG;
}

async function logGeneration(
  scope: SessionScope,
  row: {
    kind: "text" | "image";
    model: string;
    tokensIn?: number;
    tokensOut?: number;
    imageCount?: number;
    latencyMs: number;
    status: "ok" | "error" | "timeout";
    error?: string;
    contentItemId?: string | null;
  },
): Promise<void> {
  if (!scope.tenantId) return; // logs are tenant-scoped (INV-1)
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO generation_logs
         (tenant_id, kind, model, tokens_in, tokens_out, image_count,
          latency_ms, status, error, user_id, content_item_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        scope.tenantId,
        row.kind,
        row.model,
        row.tokensIn ?? null,
        row.tokensOut ?? null,
        row.imageCount ?? null,
        row.latencyMs,
        row.status,
        row.error ?? null,
        scope.userId,
        row.contentItemId ?? null,
      ],
    ),
  );
}

/**
 * The one retry policy (brief §05). A ProviderError carries its own verdict:
 * a real provider's SDK has already retried rate limits, server errors and
 * dropped connections, so it reports those as not retryable and they are NOT
 * retried again here. Stacking two retry loops turns one slow failure into a
 * minute-long hang. Config errors are never retried; nothing would change.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof AiConfigError) throw err;
      if (err instanceof ProviderError && !err.retryable) throw err;
      await new Promise((r) => setTimeout(r, 200 * (i + 1))); // backoff
    }
  }
  throw lastErr;
}

const logStatus = (err: unknown): "error" | "timeout" =>
  err instanceof ProviderError && err.kind === "timeout" ? "timeout" : "error";

export async function generateText(
  scope: SessionScope,
  req: TextGenRequest & { systemTemplate: string; contentItemId?: string | null },
) {
  const env = getEnv();
  const route = req.route ?? "strong";
  // A config error is still logged below, so a misconfigured deployment shows
  // up in usage and the audit trail, not only in a server log nobody reads.
  let model = `${env.AI_TEXT_PROVIDER}-${route}`;
  const started = Date.now();
  try {
    const provider = selectTextProvider(env);
    model = resolveTextModel(env, route);
    // INV-2: the one assembly, handed to whichever provider is configured.
    const prompt = assemblePrompt(req.systemTemplate, req.context, req.taskInput, {
      templateKey: req.templateKey,
      variants: req.variants,
    });
    const effort = resolveEffort(env, route);
    const result = await withRetry(() => provider.generate({ ...req, prompt }, model, { effort }));
    await logGeneration(scope, {
      kind: "text",
      // The model that SERVED the call: differs from the configured one when a
      // refusal fallback ran, and the audit trail should say who wrote it.
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: Date.now() - started,
      status: "ok",
      contentItemId: req.contentItemId ?? null,
    });
    return result;
  } catch (err) {
    await logGeneration(scope, {
      kind: "text",
      model,
      latencyMs: Date.now() - started,
      status: logStatus(err),
      error: err instanceof Error ? err.message : String(err),
      contentItemId: req.contentItemId ?? null,
    });
    throw err;
  }
}

export async function generateImage(
  scope: SessionScope,
  req: ImageGenRequest & { contentItemId?: string | null },
) {
  const env = getEnv();
  const model = env.AI_IMAGE_MODEL || "mock-image";
  const started = Date.now();
  try {
    const provider = selectImageProvider(env);
    const result = await withRetry(() => provider.generate(req, model));
    await logGeneration(scope, {
      kind: "image",
      model,
      imageCount: 1,
      latencyMs: Date.now() - started,
      status: "ok",
      contentItemId: req.contentItemId ?? null,
    });
    return result;
  } catch (err) {
    await logGeneration(scope, {
      kind: "image",
      model,
      latencyMs: Date.now() - started,
      status: logStatus(err),
      error: err instanceof Error ? err.message : String(err),
      contentItemId: req.contentItemId ?? null,
    });
    throw err;
  }
}

/**
 * Run a data task (lib/ai/tasks): topic proposals, the judgement half of
 * Check, a rewrite, a co-write outline. Same assembly (INV-2), same provider
 * selection, same logging and retry policy as a draft; the difference is that
 * the answer comes back validated against the task's schema.
 */
export async function runTask<T>(
  scope: SessionScope,
  task: TaskDef<T>,
  input: { context: BrandContext; taskInput: string; route?: TextRoute; contentItemId?: string | null },
): Promise<T> {
  const env = getEnv();
  const route = input.route ?? "strong";
  let model = `${env.AI_TEXT_PROVIDER}-${route}`;
  const started = Date.now();
  try {
    const provider = selectTextProvider(env);
    model = resolveTextModel(env, route);
    const template = await resolveTemplate(scope, task.key);
    const prompt = assemblePrompt(template.body, input.context, input.taskInput, {
      templateKey: task.key,
      contract: task.contract,
    });
    const req = { templateKey: task.key, context: input.context, taskInput: input.taskInput, route, prompt };
    const result = await withRetry(() =>
      provider.structured(req, model, task.schema, { effort: resolveEffort(env, route) }),
    );
    await logGeneration(scope, {
      kind: "text",
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: Date.now() - started,
      status: "ok",
      contentItemId: input.contentItemId ?? null,
    });
    return result.data;
  } catch (err) {
    await logGeneration(scope, {
      kind: "text",
      model,
      latencyMs: Date.now() - started,
      status: logStatus(err),
      error: err instanceof Error ? err.message : String(err),
      contentItemId: input.contentItemId ?? null,
    });
    throw err;
  }
}

// ---- speech to text (voice notes) -------------------------------------------

/**
 * Which transcriber, if any. "off" is a real answer, not a missing one: the
 * page offers typing instead of recording. A provider named without its key
 * or model is a config error, never a silent fallback.
 */
export function selectTranscriber(env: Env, fetchImpl?: FetchLike): Transcriber | null {
  switch (env.AI_TRANSCRIBE_PROVIDER) {
    case "off":
      return null;
    case "openai": {
      if (!env.OPENAI_API_KEY) throw new AiConfigError("AI_TRANSCRIBE_PROVIDER=openai needs OPENAI_API_KEY.");
      if (!env.AI_TRANSCRIBE_MODEL) throw new AiConfigError("AI_TRANSCRIBE_PROVIDER=openai needs AI_TRANSCRIBE_MODEL.");
      return openaiTranscriber(
        { apiKey: env.OPENAI_API_KEY, model: env.AI_TRANSCRIBE_MODEL, timeoutMs: env.AI_TEXT_TIMEOUT_MS },
        fetchImpl,
      );
    }
  }
}

export const transcriptionEnabled = (): boolean => getEnv().AI_TRANSCRIBE_PROVIDER !== "off";

/** Transcribe one voice note. Logged like every model call; the audio is not kept. */
export async function transcribe(scope: SessionScope, audio: Blob, filename: string): Promise<string> {
  const env = getEnv();
  const started = Date.now();
  let model = `${env.AI_TRANSCRIBE_PROVIDER}:transcribe`;
  try {
    const t = selectTranscriber(env);
    if (!t) throw new AiConfigError("Voice notes need transcription switched on (AI_TRANSCRIBE_PROVIDER).");
    const out = await t.transcribe(audio, filename);
    model = `${env.AI_TRANSCRIBE_PROVIDER}:${out.model}`;
    await logGeneration(scope, { kind: "text", model, latencyMs: Date.now() - started, status: "ok" });
    return out.text;
  } catch (err) {
    await logGeneration(scope, {
      kind: "text", model, latencyMs: Date.now() - started, status: logStatus(err),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
