/**
 * Pictures from Runpod Public Endpoints: managed, pay-per-picture open image
 * models (Qwen Image, FLUX, Seedream) behind one API key, no deployment. Same
 * interface as the OpenAI image provider; the facade (lib/ai) picks it from
 * AI_IMAGE_PROVIDER=runpod.
 *
 *   draw    POST /v2/<AI_IMAGE_MODEL>/runsync      { input: { prompt, size } }
 *   redraw  POST /v2/<AI_IMAGE_EDIT_MODEL>/runsync { input: { prompt, image } }
 *
 * The reply names a URL (kept 7 days by Runpod); the picture is downloaded at
 * once and handed back as PNG bytes, so nothing depends on that URL later.
 *
 * Redrawing an area: these models edit by instruction and take no mask. Told
 * in words where to change the whole picture, the model changed it where IT
 * thought best (first real run, 2026-11-17: asked for a plant on the marked
 * wall, it put the plant in the coffee cup, outside the mark, so the change
 * was thrown away). So the model is given ONLY the marked area, as a close-up
 * with a little of its surroundings, and its answer is pasted back in place.
 * The change can then only be where the person marked; the caller
 * (lib/visual/region keepOutside) still blends the edge and guarantees
 * nothing outside the mark moved.
 *
 * Plain fetch, injectable for tests. Server-only.
 */
import sharp from "sharp";
import { ProviderError } from "../errors";
import type { ImageEditRequest, ImageGenRequest, ImageGenResult, ImageProvider, ImageShape } from "../types";

export const RUNPOD_BASE = "https://api.runpod.ai/v2";

export interface RunpodImageConfig {
  apiKey: string;
  timeoutMs: number;
  /** The endpoint that redraws (image in, image out). */
  editModel: string;
  baseUrl?: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Sizes asked of the model per shape. Portrait is 4:5, the post and carousel frame. */
export const RUNPOD_SIZES: Record<ImageShape, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1280 },
  landscape: { width: 1344, height: 768 },
};

/** How much of the surroundings goes with the marked area, as a share of its size. */
const CONTEXT = 0.18;
/** The close-up is enlarged so its longer side is about this, for the model to work at. */
const WORK_SIDE = 1024;

interface JobReply {
  id?: string;
  status?: string;
  error?: unknown;
  output?: unknown;
}

function failure(status: number, what: string): ProviderError {
  const kind =
    status === 401 || status === 403 ? "auth"
    : status === 429 ? "rate_limit"
    : status >= 500 ? "server"
    : status === 400 ? "bad_request"
    : "unknown";
  return new ProviderError(kind, `${what} failed with ${status}.`, kind === "server");
}

/** The picture's address in a finished job's output, whichever field the model uses. */
export function resultUrl(output: unknown): string | null {
  if (typeof output === "string") return /^https?:\/\//.test(output) ? output : null;
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  for (const k of ["result", "image_url", "image", "url"]) {
    if (typeof o[k] === "string" && /^https?:\/\//.test(o[k] as string)) return o[k] as string;
  }
  for (const k of ["images", "results"]) {
    const first = Array.isArray(o[k]) ? (o[k] as unknown[])[0] : null;
    const found = resultUrl(first);
    if (found) return found;
  }
  return null;
}

export interface PixelBox { left: number; top: number; width: number; height: number }

/** The marked area in pixels, from the mask (transparent = may change). Null when nothing is marked. */
export async function markedBox(mask: Uint8Array): Promise<(PixelBox & { imageWidth: number; imageHeight: number }) | null> {
  try {
    const { data, info } = await sharp(Buffer.from(mask)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
    for (let y = 0; y < info.height; y += 2) {
      for (let x = 0; x < info.width; x += 2) {
        if (data[(y * info.width + x) * 4 + 3] < 128) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { left: x0, top: y0, width: x1 - x0 + 2, height: y1 - y0 + 2, imageWidth: info.width, imageHeight: info.height };
  } catch {
    return null;
  }
}

/** The marked area plus a little of its surroundings, kept inside the picture. */
export function closeUp(box: PixelBox, imageWidth: number, imageHeight: number): PixelBox {
  const mx = Math.round(box.width * CONTEXT);
  const my = Math.round(box.height * CONTEXT);
  const left = Math.max(0, box.left - mx);
  const top = Math.max(0, box.top - my);
  const right = Math.min(imageWidth, box.left + box.width + mx);
  const bottom = Math.min(imageHeight, box.top + box.height + my);
  return { left, top, width: Math.max(8, right - left), height: Math.max(8, bottom - top) };
}

/**
 * What the person asked for (the caller's first line), and its rule about words
 * (the line that starts with it). Matched by the start of a line only: the
 * picture's own description carries "No words, letters..." too, and must not
 * be taken for the rule.
 */
export function askOf(prompt: string): { ask: string; words: string } {
  const lines = prompt.split("\n").map((l) => l.trim()).filter(Boolean);
  const ask = (lines[0] ?? "").replace(/^Change only the marked area:\s*/i, "");
  const words = lines.find((l, i) => i > 0 && /^(Any text in the area|No words, letters)/i.test(l)) ?? "";
  return { ask, words };
}

/**
 * The instruction for the close-up. These models replace by instruction, so the
 * instruction says to replace the marked content entirely (what is there now,
 * text and numbers included, is removed, not kept or copied) and to add no
 * words unless asked. Without the close-up's own edge it joins the rest of the
 * picture (the caller's mask still keeps everything outside the box).
 */
export function closeUpPrompt(prompt: string, marked: boolean): string {
  const { ask, words } = askOf(prompt);
  const text = marked
    ? [
        `Replace everything in this image with: ${ask}.`,
        "Remove what is there now completely, including any text, letters, numbers, calendar dates or symbols. Do not keep, copy or redraw any of it.",
        words || "Add no text, letters, numbers or logos unless the request names them.",
        "This image is a close-up of one part of a larger picture. Draw the new content across the middle. Keep the same style, light and colours, and keep the outer edge plain so it joins the rest.",
      ]
    : [ask, words, "Keep the same style, light and colours."];
  return text.filter(Boolean).join("\n\n").slice(0, 4000);
}

export function runpodImageProvider(config: RunpodImageConfig, fetchImpl: FetchLike = fetch): ImageProvider {
  const base = (config.baseUrl ?? RUNPOD_BASE).replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${config.apiKey}` };

  const send = async (url: string, init: RequestInit, what: string, deadline: number): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new ProviderError(timedOut ? "timeout" : "unknown", timedOut ? `${what} timed out.` : `${what} request failed.`, true);
    }
    if (!res.ok) throw failure(res.status, what);
    return res;
  };

  /** Run one job to the end: runsync answers when done, or hands back an id to wait on. */
  const run = async (model: string, input: Record<string, unknown>, what: string): Promise<string> => {
    const deadline = Date.now() + config.timeoutMs;
    const first = await send(`${base}/${model}/runsync`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ input }) }, what, deadline);
    let job = (await first.json().catch(() => null)) as JobReply | null;
    while (job && (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS") && job.id) {
      if (Date.now() > deadline) throw new ProviderError("timeout", `${what} timed out.`, true);
      await new Promise((r) => setTimeout(r, 2000));
      const next = await send(`${base}/${model}/status/${job.id}`, { headers: auth }, what, deadline);
      job = (await next.json().catch(() => null)) as JobReply | null;
    }
    if (!job || job.status !== "COMPLETED") {
      const why = typeof job?.error === "string" ? job.error.slice(0, 200) : "no reason given";
      throw new ProviderError("bad_request", `${what} was refused by the image service: ${why}`);
    }
    const url = resultUrl(job.output);
    if (!url) throw new ProviderError("unparseable", "The picture reply had no image.");
    return url;
  };

  /** Download the result now (the URL expires). */
  const download = async (url: string): Promise<Buffer> => {
    const res = await send(url, {}, "Fetching the picture", Date.now() + Math.min(config.timeoutMs, 60_000));
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.byteLength < 100) throw new ProviderError("unparseable", "The picture reply was empty.");
    return raw;
  };

  const asPng = async (img: ReturnType<typeof sharp>, model: string): Promise<ImageGenResult> => {
    try {
      const { data, info } = await img.png().toBuffer({ resolveWithObject: true });
      return { bytes: new Uint8Array(data), mime: "image/png", model, width: info.width, height: info.height };
    } catch {
      throw new ProviderError("unparseable", "The picture came back unreadable.");
    }
  };

  return {
    name: "runpod",

    async generate(req: ImageGenRequest, model: string) {
      const { width, height } = RUNPOD_SIZES[req.shape ?? "square"];
      // FLUX endpoints take width and height; the others take "width*height".
      const input = /flux/i.test(model)
        ? { prompt: req.prompt.slice(0, 4000), width, height, seed: -1 }
        : { prompt: req.prompt.slice(0, 4000), negative_prompt: (req.negativePrompt ?? "").slice(0, 1000), size: `${width}*${height}`, seed: -1, enable_safety_checker: true };
      return asPng(sharp(await download(await run(model, input, "Drawing the picture"))), model);
    },

    async edit(req: ImageEditRequest) {
      const model = config.editModel;
      const source = Buffer.from(req.source);
      const meta = await sharp(source).metadata().catch(() => null);
      if (!meta?.width || !meta.height) throw new ProviderError("bad_request", "The picture to change couldn't be read.");
      const marked = await markedBox(req.mask);
      // Nothing marked (or an unreadable mask): the whole picture is the area.
      const area = marked ? closeUp(marked, meta.width, meta.height) : { left: 0, top: 0, width: meta.width, height: meta.height };

      // The close-up, enlarged to a size the model draws well at.
      const scale = Math.min(4, WORK_SIDE / Math.max(area.width, area.height));
      const workW = Math.max(64, Math.round((area.width * scale) / 8) * 8);
      const workH = Math.max(64, Math.round((area.height * scale) / 8) * 8);
      const crop = await sharp(source).extract(area).resize(workW, workH, { fit: "fill" }).png().toBuffer();

      const prompt = closeUpPrompt(req.prompt, !!marked);
      // The picture travels inline: it is private, and the app may not be reachable from outside.
      const image = `data:image/png;base64,${crop.toString("base64")}`;
      const input = /2511|kontext|seedream|banana/i.test(model)
        ? { prompt, images: [image], image, seed: -1, output_format: "png" }
        : { prompt, image, negative_prompt: "", seed: -1, output_format: "png", enable_safety_checker: true };
      const answer = await download(await run(model, input, "Changing the picture"));

      // Back to the close-up's own size and into its place in the full picture.
      let patch: Buffer;
      try {
        patch = await sharp(answer).resize(area.width, area.height, { fit: "fill" }).png().toBuffer();
      } catch {
        throw new ProviderError("unparseable", "The picture came back unreadable.");
      }
      return asPng(sharp(source).composite([{ input: patch, left: area.left, top: area.top }]), model);
    },
  };
}
