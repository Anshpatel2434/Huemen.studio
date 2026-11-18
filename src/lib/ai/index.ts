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
  StreamingTextProvider,
  TextGenRequest,
  ImageEditRequest,
  ImageGenResult,
} from "./types";
import { mockImageProvider, mockTextProvider } from "./providers/mock";
import { anthropicTextProvider } from "./providers/anthropic";
import { groqTextProvider, GROQ_BASE } from "./providers/groq";
import { openaiTranscriber, type FetchLike, type Transcriber } from "./providers/openai-transcribe";
import { openaiImageProvider, type FetchLike as ImageFetch } from "./providers/openai-image";
import { runpodImageProvider } from "./providers/runpod-image";
import { assemblePrompt, taskRules } from "./prompt";
import { cleanDeep, cleanModelText, streamCleaner } from "@/lib/content/clean";
import { isUuid } from "@/lib/content/ids";
import { AiConfigError, ProviderError, UsageCapError } from "./errors";
import { takeHit } from "@/lib/ratelimit";
import type { Env } from "@/lib/env";
import { MAX_TASK_IMAGES, type Effort, type TextImage, type TextRoute } from "./types";
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
let _anthropic: StreamingTextProvider | null = null;
let _groq: StreamingTextProvider | null = null;

export function selectTextProvider(env: Env): StreamingTextProvider {
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
    case "groq":
      if (!env.GROQ_API_KEY) throw new AiConfigError("AI_TEXT_PROVIDER=groq needs GROQ_API_KEY.");
      _groq ??= groqTextProvider({ apiKey: env.GROQ_API_KEY, timeoutMs: env.AI_TEXT_TIMEOUT_MS });
      return _groq;
    case "openai":
      throw new AiConfigError(
        'AI_TEXT_PROVIDER=openai is not built. Use "anthropic" or "groq", or "mock" for local development.',
      );
  }
}

/**
 * Pictures: OpenAI's GPT Image ("ChatGPT Image") or the stand-in. Text stays
 * on the text provider (Claude). A provider named without its key or model is
 * a config error, never a silent fallback to the stand-in.
 */
export function selectImageProvider(env: Env, fetchImpl?: ImageFetch): ImageProvider {
  switch (env.AI_IMAGE_PROVIDER) {
    case "mock":
      return mockImageProvider;
    case "openai":
      if (!env.OPENAI_API_KEY) throw new AiConfigError("AI_IMAGE_PROVIDER=openai needs OPENAI_API_KEY.");
      if (!env.AI_IMAGE_MODEL) throw new AiConfigError("AI_IMAGE_PROVIDER=openai needs AI_IMAGE_MODEL (the current GPT Image model name).");
      return openaiImageProvider({ apiKey: env.OPENAI_API_KEY, timeoutMs: env.AI_IMAGE_TIMEOUT_MS }, fetchImpl);
    case "runpod":
      if (!env.RUNPOD_API_KEY) throw new AiConfigError("AI_IMAGE_PROVIDER=runpod needs RUNPOD_API_KEY.");
      if (!env.AI_IMAGE_MODEL) throw new AiConfigError("AI_IMAGE_PROVIDER=runpod needs AI_IMAGE_MODEL (a Runpod public endpoint id, e.g. qwen-image-t2i).");
      return runpodImageProvider(
        { apiKey: env.RUNPOD_API_KEY, timeoutMs: env.AI_IMAGE_TIMEOUT_MS, editModel: env.AI_IMAGE_EDIT_MODEL || "qwen-image-edit" },
        fetchImpl as never,
      );
    case "replicate":
      throw new AiConfigError('AI_IMAGE_PROVIDER=replicate is not built. Use "openai" or "runpod", or "mock" for local development.');
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

/**
 * The model that looks at pictures (vision), from config. AI_VISION_MODEL
 * names it; on Anthropic the strong model reads images too, so it is used when
 * AI_VISION_MODEL is unset. Groq needs it named (a vision-capable model such
 * as qwen/qwen3.8-27b). Never guessed in code.
 */
export function resolveVisionModel(env: Env): string {
  if (env.AI_VISION_MODEL) return env.AI_VISION_MODEL;
  if (env.AI_TEXT_PROVIDER === "mock") return "mock-vision";
  if (env.AI_TEXT_PROVIDER === "anthropic" && env.AI_TEXT_MODEL_STRONG) return env.AI_TEXT_MODEL_STRONG;
  throw new AiConfigError(
    "AI_VISION_MODEL is not set. Name a model that reads images in .env (see .env.example), e.g. qwen/qwen3.8-27b on Groq.",
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
): Promise<string | null> {
  if (!scope.tenantId) return null; // logs are tenant-scoped (INV-1)
  const r = await withTenantSession(scope, (c) =>
    c.query<{ id: string }>(
      `INSERT INTO generation_logs
         (tenant_id, kind, model, tokens_in, tokens_out, image_count,
          latency_ms, status, error, user_id, content_item_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
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
        // Only a real id: a malformed one must not turn a logged call into a database error.
        isUuid(row.contentItemId) ? row.contentItemId : null,
      ],
    ),
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Tie a model call to the piece it was made for, after the fact. A new draft
 * (or an outline) is written before its piece exists, so its log row is
 * written without one; the caller links it here once the piece is saved.
 * Every model call made for a piece then carries its content_item_id
 * (generation_logs is the audit trail: AGENTS.md §3). Never overwrites a
 * link, and RLS keeps it inside the workspace (INV-1).
 */
export async function linkGeneration(scope: SessionScope, logId: string | null | undefined, contentItemId: string): Promise<void> {
  if (!scope.tenantId || !isUuid(logId) || !isUuid(contentItemId)) return;
  await withTenantSession(scope, (c) =>
    c.query(`UPDATE generation_logs SET content_item_id = $1 WHERE id = $2 AND content_item_id IS NULL`, [contentItemId, logId]),
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

/**
 * The hard stop (brief §4.6: a soft warning and a hard stop, admin-set). Runs
 * before the provider is reached. Successful calls this month are counted
 * against the cap; failed ones cost nothing and are not. No cap row, or a
 * null hard cap, means unlimited (the admin page says so); 0 switches that
 * kind of generation off. Every query names the workspace, so the count is
 * right even under a scope that can see more than one.
 */
export async function enforceCap(scope: SessionScope, kind: "text" | "image"): Promise<void> {
  if (!scope.tenantId) return;
  // The short window first: a burst is refused before the month is counted.
  const env = getEnv();
  await takeHit(scope, "ai", {
    perUser: env.AI_RATE_PER_USER_MINUTE,
    perTenant: env.AI_RATE_PER_WORKSPACE_MINUTE,
    windowSeconds: 60,
  });
  const col = kind === "text" ? "monthly_text_hard" : "monthly_image_hard";
  const row = await withTenantSession(scope, async (c) => {
    const cap = (await c.query<{ hard: number | null }>(`SELECT ${col} AS hard FROM tenant_usage_caps WHERE tenant_id = $1`, [scope.tenantId])).rows[0];
    if (cap?.hard == null) return null;
    const used = (
      await c.query<{ n: number }>(
        kind === "text"
          ? `SELECT count(*)::int AS n FROM generation_logs WHERE tenant_id = $1 AND kind='text' AND status='ok' AND created_at >= date_trunc('month', now())`
          : `SELECT coalesce(sum(image_count),0)::int AS n FROM generation_logs WHERE tenant_id = $1 AND kind='image' AND status='ok' AND created_at >= date_trunc('month', now())`,
        [scope.tenantId],
      )
    ).rows[0].n;
    return { used, cap: cap.hard };
  });
  if (row && row.used >= row.cap) throw new UsageCapError(kind, row.used, row.cap);
}

/**
 * Sampling temperature by use (audit M1). A judgement, or a rewrite, should give
 * the same answer on a rerun, so it runs low. A draft may vary, so it runs
 * moderate. Tasks not listed keep the provider's default. Chosen here, never in
 * feature code. No seed: the providers do not offer a reliable one.
 */
export const TEMPERATURE = { judge: 0.2, rewrite: 0.3, draft: 0.7 } as const;

const TASK_TEMPERATURE: Record<string, number> = {
  voice_judge: TEMPERATURE.judge,
  rewrite_in_voice: TEMPERATURE.rewrite,
  rewrite_part: TEMPERATURE.rewrite,
  // Reading designs is a judgement: the same designs should read the same way twice.
  look_read: TEMPERATURE.judge,
};

/** The temperature a task runs at, or undefined to keep the provider default. */
export function temperatureFor(taskKey: string): number | undefined {
  return TASK_TEMPERATURE[taskKey];
}

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
    await enforceCap(scope, "text");
    const provider = selectTextProvider(env);
    model = resolveTextModel(env, route);
    // INV-2: the one assembly, handed to whichever provider is configured.
    const prompt = assemblePrompt(req.systemTemplate, req.context, req.taskInput, {
      templateKey: req.templateKey,
      variants: req.variants,
    });
    const effort = resolveEffort(env, route);
    const result = await withRetry(() => provider.generate({ ...req, prompt }, model, { effort, temperature: TEMPERATURE.draft }));
    const logId = await logGeneration(scope, {
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
    // The one clean-up for model text (lib/content/clean), before any caller sees it.
    const clean = { noEmDash: req.context.writing?.noEmDash };
    const variants = result.variants.map((v) => cleanModelText(v, clean));
    // Fewer versions than asked for are kept, but said, not hidden (audit L2).
    const wanted = Math.max(1, req.variants ?? 1);
    const warnings = variants.length < wanted ? [`The model returned ${variants.length} of the ${wanted} versions asked for.`] : [];
    return { ...result, variants, warnings, logId };
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

/**
 * A draft written live (brief §07: stream anything the user waits on). Same
 * cap, provider selection, prompt assembly (INV-2) and logging as
 * generateText; the prompt asks for plain text with STREAM_SEPARATOR between
 * versions. No retry: once text has reached the screen, a second attempt
 * would show the person two different drafts in one place. The log row is
 * written when the stream ends, success or failure, before the caller saves.
 */
export async function* streamText(
  scope: SessionScope,
  req: TextGenRequest & {
    systemTemplate: string;
    contentItemId?: string | null;
    /** Replaces the draft contract, for a stream that is not a draft (the agent's answers). */
    contract?: string;
    /** A fixed output spec placed in the cached system part (see assemblePrompt). */
    systemContract?: string;
  },
): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; text: string; model: string; logId: string | null }> {
  const env = getEnv();
  const route = req.route ?? "strong";
  let model = `${env.AI_TEXT_PROVIDER}-${route}`;
  const started = Date.now();
  let text = "";
  let logged = false;
  // What reaches the screen is already clean (lib/content/clean), so the
  // words on the canvas are the words that get saved.
  const cleaner = streamCleaner({ noEmDash: req.context.writing?.noEmDash });
  try {
    await enforceCap(scope, "text");
    const provider = selectTextProvider(env);
    model = resolveTextModel(env, route);
    const prompt = assemblePrompt(req.systemTemplate, req.context, req.taskInput, {
      templateKey: req.templateKey,
      variants: req.variants,
      stream: true,
      contract: req.contract,
      systemContract: req.systemContract,
    });
    for await (const ev of provider.stream({ ...req, prompt }, model, { effort: resolveEffort(env, route), temperature: TEMPERATURE.draft })) {
      if (ev.type === "delta") {
        const out = cleaner.push(ev.text);
        text += out;
        if (out) yield { type: "delta", text: out };
        continue;
      }
      const tail = cleaner.flush();
      text += tail;
      if (tail) yield { type: "delta", text: tail };
      // What the person watched (text) must be what gets saved (final). If a
      // provider ends with different words, nothing is kept (audit H3).
      const final = ev.text ? cleanModelText(ev.text, { noEmDash: req.context.writing?.noEmDash }) : text;
      if (final !== text) {
        throw new ProviderError("unknown", "The draft changed while it was being written, so it was not kept. Try again.", true);
      }
      logged = true;
      const logId = await logGeneration(scope, {
        kind: "text",
        model: ev.model,
        tokensIn: ev.tokensIn,
        tokensOut: ev.tokensOut,
        latencyMs: Date.now() - started,
        status: "ok",
        contentItemId: req.contentItemId ?? null,
      });
      yield { type: "done", text: final, model: ev.model, logId };
      return;
    }
    throw new ProviderError("unparseable", "The stream ended without finishing.");
  } catch (err) {
    logged = true;
    await logGeneration(scope, {
      kind: "text",
      model,
      latencyMs: Date.now() - started,
      status: logStatus(err),
      error: err instanceof Error ? err.message : String(err),
      contentItemId: req.contentItemId ?? null,
    });
    throw err;
  } finally {
    // The reader went away mid-stream (tab closed, connection dropped): the
    // generator is closed without an error, so neither branch above ran. The
    // model was still called, so the call is still written down.
    if (!logged) {
      await logGeneration(scope, {
        kind: "text",
        model,
        latencyMs: Date.now() - started,
        status: "error",
        error: `Stopped before it finished: the page was closed after ${text.length} characters.`,
        contentItemId: req.contentItemId ?? null,
      }).catch(() => {});
    }
  }
}

export async function generateImage(
  scope: SessionScope,
  req: ImageGenRequest & { contentItemId?: string | null },
) {
  return imageCall(scope, req.contentItemId ?? null, (p, model) => p.generate(req, model));
}

/** Redraw one area of a picture (the mask marks it). Same cap, limits, retry and log as a new picture. */
export async function editImage(
  scope: SessionScope,
  req: ImageEditRequest & { contentItemId?: string | null },
) {
  return imageCall(scope, req.contentItemId ?? null, (p, model) => p.edit(req, model));
}

async function imageCall(
  scope: SessionScope,
  contentItemId: string | null,
  run: (provider: ImageProvider, model: string) => Promise<ImageGenResult>,
) {
  const env = getEnv();
  const model = env.AI_IMAGE_PROVIDER === "mock" ? env.AI_IMAGE_MODEL || "mock-image" : env.AI_IMAGE_MODEL ?? "";
  const req = { contentItemId };
  const started = Date.now();
  try {
    await enforceCap(scope, "image");
    const provider = selectImageProvider(env);
    const result = await withRetry(() => run(provider, model));
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
  input: TaskInput,
): Promise<T> {
  return (await runTaskStamped(scope, task, input)).data;
}

export interface TaskInput {
  context: BrandContext;
  taskInput: string;
  route?: TextRoute;
  contentItemId?: string | null;
  /**
   * Pictures for the model to look at (vision), at most MAX_TASK_IMAGES,
   * already downscaled. A task with pictures runs on the vision model
   * (resolveVisionModel); everything else (cap, template, context, retry,
   * log) is the same as any task.
   */
  images?: TextImage[];
}

/**
 * runTask, also saying which template version and model wrote the answer, so
 * a caller that saves AI-written text onto a piece can stamp it (brief §05:
 * the template version is stamped on every content_item).
 */
export async function runTaskStamped<T>(
  scope: SessionScope,
  task: TaskDef<T>,
  input: TaskInput,
): Promise<{ data: T; model: string; template: { id: string | null; version: number }; logId: string | null }> {
  const env = getEnv();
  const route = input.route ?? "strong";
  const images = input.images ?? [];
  const vision = images.length > 0;
  let model = vision ? `${env.AI_TEXT_PROVIDER}-vision` : `${env.AI_TEXT_PROVIDER}-${route}`;
  const started = Date.now();
  try {
    if (images.length > MAX_TASK_IMAGES) throw new Error(`At most ${MAX_TASK_IMAGES} pictures can go with one request.`);
    await enforceCap(scope, "text");
    const provider = selectTextProvider(env);
    model = vision ? resolveVisionModel(env) : resolveTextModel(env, route);
    const template = await resolveTemplate(scope, task.key);
    const prompt = assemblePrompt(template.body, input.context, input.taskInput, {
      templateKey: task.key,
      // The task's own contract, then the shared rules it asks for (facts,
      // the ask, the measured length, plain characters), read from the one
      // context so a rewrite is held to the same numbers as a draft.
      contract: [task.contract, ...taskRules(task.rules, input.context)].join("\n"),
    });
    const req = { templateKey: task.key, context: input.context, taskInput: input.taskInput, route, prompt, ...(vision ? { images } : {}) };
    // The route's thinking depth is set for the route's model; the vision
    // model is another model, so nothing is sent for it.
    const effort = vision ? undefined : resolveEffort(env, route);
    const result = await withRetry(() =>
      provider.structured(req, model, task.schema, { effort, temperature: temperatureFor(task.key) }),
    );
    const logId = await logGeneration(scope, {
      kind: "text",
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: Date.now() - started,
      status: "ok",
      contentItemId: input.contentItemId ?? null,
    });
    // Every string a task returns is model text: cleaned here, once, except
    // the fields that quote the input back (task.verbatim).
    const data = cleanDeep(result.data, { noEmDash: input.context.writing?.noEmDash }, task.verbatim);
    return { data, model: result.model, template: { id: template.id, version: template.version }, logId };
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
    case "groq": {
      if (!env.GROQ_API_KEY) throw new AiConfigError("AI_TRANSCRIBE_PROVIDER=groq needs GROQ_API_KEY.");
      if (!env.AI_TRANSCRIBE_MODEL) throw new AiConfigError("AI_TRANSCRIBE_PROVIDER=groq needs AI_TRANSCRIBE_MODEL (e.g. whisper-large-v3-turbo).");
      // Groq's Whisper is the same multipart endpoint shape as OpenAI's.
      return openaiTranscriber(
        { apiKey: env.GROQ_API_KEY, model: env.AI_TRANSCRIBE_MODEL, timeoutMs: env.AI_TEXT_TIMEOUT_MS, endpoint: `${GROQ_BASE}/audio/transcriptions` },
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
    // A transcription is a paid model call like any other: same per-minute
    // limit and monthly cap, checked before the audio leaves the server.
    await enforceCap(scope, "text");
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
