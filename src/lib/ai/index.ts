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
import type { BrandContext } from "@/lib/context/context-builder";
import type {
  ImageGenRequest,
  ImageProvider,
  TextGenRequest,
  TextProvider,
} from "./types";
import { mockImageProvider, mockTextProvider } from "./providers/mock";

function textProvider(): TextProvider {
  switch (getEnv().AI_TEXT_PROVIDER) {
    case "mock":
      return mockTextProvider;
    // case "openai": return openaiTextProvider;  (wire at integration time)
    default:
      return mockTextProvider;
  }
}

function imageProvider(): ImageProvider {
  switch (getEnv().AI_IMAGE_PROVIDER) {
    case "mock":
      return mockImageProvider;
    default:
      return mockImageProvider;
  }
}

function textModel(route: "strong" | "cheap"): string {
  const env = getEnv();
  return (
    (route === "cheap" ? env.AI_TEXT_MODEL_CHEAP : env.AI_TEXT_MODEL_STRONG) ??
    `mock-${route}`
  );
}

/** Assemble the final prompt (INV-2 order). */
export function assemblePrompt(
  systemTemplate: string,
  context: BrandContext,
  taskInput: string,
): string {
  return [
    systemTemplate.trim(),
    "",
    "<brand_context>",
    context.serialized,
    "</brand_context>",
    "",
    "<task>",
    taskInput.trim(),
    "</task>",
  ].join("\n");
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

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200 * (i + 1))); // backoff
    }
  }
  throw lastErr;
}

export async function generateText(
  scope: SessionScope,
  req: TextGenRequest & { systemTemplate: string; contentItemId?: string | null },
) {
  const provider = textProvider();
  const model = textModel(req.route ?? "strong");
  const started = Date.now();
  try {
    const result = await withRetry(() => provider.generate(req, model));
    await logGeneration(scope, {
      kind: "text",
      model,
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
      status: "error",
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
  const provider = imageProvider();
  const model = getEnv().AI_IMAGE_MODEL ?? "mock-image";
  const started = Date.now();
  try {
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
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      contentItemId: req.contentItemId ?? null,
    });
    throw err;
  }
}
