/**
 * Pictures through OpenAI's Images API ("ChatGPT Image"): one call to draw a
 * picture, one to redraw an area of it (image + mask). Text stays on Claude;
 * this provider only ever makes pictures.
 *
 * Plain fetch, like the transcriber: two endpoints, no SDK dependency. The
 * model is config (AI_IMAGE_MODEL), never named here, so a newer model is a
 * setting change. The fetch is injectable so tests never touch the network.
 *
 * Server-only.
 */
import { ProviderError } from "../errors";
import type { ImageEditRequest, ImageGenRequest, ImageGenResult, ImageProvider, ImageShape } from "../types";

export interface OpenAiImageConfig {
  apiKey: string;
  timeoutMs: number;
  /** Override for tests or a proxy in the client's own account. */
  baseUrl?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** The sizes the GPT Image models accept; the visual crops to its own frame afterwards. */
export const SIZES: Record<ImageShape, { size: string; width: number; height: number }> = {
  square: { size: "1024x1024", width: 1024, height: 1024 },
  portrait: { size: "1024x1536", width: 1024, height: 1536 },
  landscape: { size: "1536x1024", width: 1536, height: 1024 },
};

/** What the model is told on top of the brief, every time. */
function fullPrompt(prompt: string, negative?: string): string {
  return [prompt.trim(), negative?.trim() ? `Avoid: ${negative.trim()}` : ""].filter(Boolean).join("\n\n").slice(0, 30_000);
}

function failure(status: number, what: string): ProviderError {
  const kind =
    status === 401 || status === 403 ? "auth"
    : status === 429 ? "rate_limit"
    : status >= 500 ? "server"
    : status === 400 ? "bad_request"
    : "unknown";
  return new ProviderError(kind, `${what} failed with ${status}.`, kind === "rate_limit" || kind === "server");
}

async function picture(res: Response, model: string, shape: ImageShape): Promise<ImageGenResult> {
  const body = (await res.json().catch(() => null)) as { data?: { b64_json?: unknown }[] } | null;
  const b64 = body?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) throw new ProviderError("unparseable", "The picture reply had no image.");
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (bytes.byteLength < 100) throw new ProviderError("unparseable", "The picture reply was empty.");
  return { bytes, mime: "image/png", model, width: SIZES[shape].width, height: SIZES[shape].height };
}

export function openaiImageProvider(config: OpenAiImageConfig, fetchImpl: FetchLike = fetch): ImageProvider {
  const base = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");

  const call = async (path: string, init: RequestInit, what: string): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${config.apiKey}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new ProviderError(timedOut ? "timeout" : "unknown", timedOut ? `${what} timed out.` : `${what} request failed.`, true);
    }
    if (!res.ok) throw failure(res.status, what);
    return res;
  };

  return {
    name: "openai",
    async generate(req: ImageGenRequest, model: string) {
      const shape = req.shape ?? "square";
      const res = await call(
        "/images/generations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: fullPrompt(req.prompt, req.negativePrompt), size: SIZES[shape].size, n: 1, output_format: "png" }),
        },
        "Drawing the picture",
      );
      return picture(res, model, shape);
    },
    async edit(req: ImageEditRequest, model: string) {
      const shape = req.shape ?? "square";
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", fullPrompt(req.prompt));
      form.append("size", SIZES[shape].size);
      form.append("n", "1");
      form.append("output_format", "png");
      form.append("image", new Blob([new Uint8Array(req.source)], { type: "image/png" }), "picture.png");
      form.append("mask", new Blob([new Uint8Array(req.mask)], { type: "image/png" }), "mask.png");
      const res = await call("/images/edits", { method: "POST", body: form }, "Changing the picture");
      return picture(res, model, shape);
    },
  };
}
