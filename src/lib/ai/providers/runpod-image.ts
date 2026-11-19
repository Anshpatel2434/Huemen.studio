/**
 * Pictures from Runpod Public Endpoints: managed, pay-per-picture open image
 * models (Qwen Image, FLUX, Seedream) behind one API key, no deployment. Same
 * interface as the OpenAI image provider; the facade (lib/ai) picks it from
 * AI_IMAGE_PROVIDER=runpod.
 *
 *   draw    POST /v2/<AI_IMAGE_MODEL>/runsync      { input: { prompt, size } }
 *   redraw  POST /v2/<AI_IMAGE_EDIT_MODEL>/runsync { input: { prompt, image } }
 *   extend  POST /v2/<AI_IMAGE_EXTEND_MODEL>/runsync { input: { prompt, images: [image] } }
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
 * The picture tools (2026-11-18) say what a change is for (ImageEditRequest
 * `intent`), and each is worded and framed its own way here:
 *
 *   area     the close-up above. With hand-drawn `marks`, they are shown on
 *            the close-up and the model is told to follow them and the note,
 *            then remove them.
 *   erase    on its own endpoint (AI_IMAGE_ERASE_MODEL; the edit endpoint
 *            when none is named): the close-up of the brushed area's box, with
 *            more of its surroundings (the fill is copied from them). Three ways to show
 *            what goes, behind ERASE_VARIANT: the brushed area cleared and
 *            roughly filled from around it first, the model asked only to
 *            make the patch blend ("fill", the default); painted flat
 *            magenta ("tint"); or left as it is and described ("clean").
 *   extend   no close-up: the whole canvas (the picture on a flat green
 *            matte) goes to the extend model (AI_IMAGE_EXTEND_MODEL), which
 *            fills the green.
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
  /** The endpoint that fills a bigger frame (AI_IMAGE_EXTEND_MODEL). Left out, the edit endpoint does it. */
  extendModel?: string;
  /** The endpoint that erases (AI_IMAGE_ERASE_MODEL). Left out, the edit endpoint does it. */
  eraseModel?: string;
  /** How Erase shows the model what goes (AI_IMAGE_ERASE_VARIANT). Left out: ERASE_VARIANT. */
  eraseVariant?: EraseVariant;
  baseUrl?: string;
}

/**
 * How Erase shows the model what to remove. "tint": the brushed area is
 * painted flat magenta on the close-up and the instruction names the paint.
 * "clean": the close-up is sent as it is and the instruction says "the object
 * in the middle". "fill": the brushed pixels are cleared and filled from the
 * colours around them (fillBrushed) before the model sees the close-up, so
 * what goes is already gone and the model only makes the patch blend.
 * Live trials 2026-11-18 on qwen-image-edit: "tint" came back with the
 * magenta paint still on and the coins under it untouched; "clean" removed
 * coins but twice handed a thin rod back untouched; "fill" lost the rod but
 * drew a pale blob in its place. Erase therefore runs on its own endpoint
 * (AI_IMAGE_ERASE_MODEL, default google-nano-banana-2-edit, which follows
 * paint), with "tint" (AI_IMAGE_ERASE_VARIANT) as the default here.
 */
export type EraseVariant = "fill" | "tint" | "clean";
export const ERASE_VARIANT: EraseVariant = "tint";

const FILL = "fill it with the surrounding background/surface, continuing its texture, light and colours. Add nothing new. No text.";
export const ERASE_PROMPTS: Record<EraseVariant, string> = {
  fill: "The blurry patch in the middle of this image was cleared and roughly filled in. Repaint only that patch so it continues the surrounding background/surface naturally, with its texture, light and colours, as if nothing had ever been there. Add nothing new: no objects, no text. Keep everything else exactly as it is.",
  tint: `Remove everything under the magenta paint and the paint itself; ${FILL}`,
  clean: `Remove the object in the middle of this image; ${FILL}`,
};

/**
 * Erasing the words a picture should not have (ImageEditRequest `erase:
 * "words"`): the close-up goes as it is, nothing painted on it, and only
 * writing is to go. Live 2026-11-19 with "tint": a box a vision model put on
 * a shadow by mistake came back as a flat pale patch, and a box a little off
 * the word left half of it. Told to remove writing, the model leaves a box
 * with none in it alone.
 */
export const ERASE_WORDS_PROMPT =
  "Remove all writing from this image: every letter, word, number and logo, printed, engraved or reflected, filling where it was with the surface around it, continuing its texture, colour, light and reflections. Change nothing else: keep every object, edge, band of colour, shadow and highlight exactly as it is. Add nothing new.";

/**
 * The brushed pixels (mask transparent) cleared and filled from the colours
 * around them: a normalised blur of the unbrushed picture, so each brushed
 * pixel takes the colours nearest it, wide enough to reach the middle of the
 * stroke. Unbrushed pixels are untouched. RGB PNG at the picture's size.
 */
export async function fillBrushed(source: Buffer, mask: Uint8Array, width: number, height: number): Promise<Buffer> {
  const img = await sharp(source).removeAlpha().raw().toBuffer();
  const m = await sharp(Buffer.from(mask)).resize(width, height, { fit: "fill", kernel: "nearest" }).ensureAlpha().raw().toBuffer();
  const keep = Buffer.alloc(width * height);
  const pre = Buffer.alloc(width * height * 3);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (m[i * 4 + 3] >= 128) {
        keep[i] = 255;
        pre[i * 3] = img[i * 3];
        pre[i * 3 + 1] = img[i * 3 + 1];
        pre[i * 3 + 2] = img[i * 3 + 2];
      } else {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return sharp(img, { raw: { width, height, channels: 3 } }).png().toBuffer();
  // Wide enough that the middle of the brushed area still gets weight from its rim.
  const sigma = Math.max(4, Math.min(80, 0.6 * Math.min(x1 - x0 + 1, y1 - y0 + 1)));
  const colour = await sharp(pre, { raw: { width, height, channels: 3 } }).blur(sigma).raw().toBuffer();
  // extractChannel: sharp hands a one-channel picture back as three unless told which one is wanted.
  const weight = await sharp(keep, { raw: { width, height, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer();
  const out = Buffer.from(img);
  for (let i = 0; i < width * height; i++) {
    if (keep[i]) continue;
    const w = weight[i] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = w > 0.02 ? Math.min(255, Math.round(colour[i * 3 + c] / w)) : 128;
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
export const EXTEND_PROMPT = "Fill the solid green area so it continues the scene naturally. Do not change, move or resize anything that is not green. No text, letters or logos.";

/** The paint over a brushed area ("tint"): flat magenta, mostly opaque. */
const TINT = { r: 255, g: 0, b: 255, alpha: 166 };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Sizes asked of the model per shape. Portrait is 4:5, the post and carousel frame. */
export const RUNPOD_SIZES: Record<ImageShape, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1280 },
  landscape: { width: 1344, height: 768 },
};

/**
 * How much of the surroundings goes with the marked area, as a share of its
 * size. 0.25 (was 0.18): more of what crosses the area's edge is in view, so
 * the model carries it through in line with the original (2026-11-18 seam).
 */
const CONTEXT = 0.25;
/** Erase fills from the surroundings, so it is shown more of them. */
const ERASE_CONTEXT = 0.4;
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
export function closeUp(box: PixelBox, imageWidth: number, imageHeight: number, context = CONTEXT, fromLonger = false): PixelBox {
  // fromLonger (Erase): both margins from the area's longer side, so a thin
  // brush stroke still comes with enough of what is around it to fill from
  // (a narrow strip over a rod came back with the rod kept, 2026-11-18).
  const longer = Math.max(box.width, box.height);
  const mx = Math.round((fromLonger ? longer : box.width) * context);
  const my = Math.round((fromLonger ? longer : box.height) * context);
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

/**
 * The instruction when the person drew on the picture (Markup): the marks are
 * on the close-up the model sees. They say where and how; the note says what.
 * The marks themselves must not be in the answer.
 */
export function markupPrompt(prompt: string): string {
  const { ask, words } = askOf(prompt);
  return [
    "This image has bright magenta hand-drawn marks on it (a circle, an arrow, a scribble). They are instructions, not part of the picture: they show where to change it.",
    `Follow the hand-drawn marks and this note: ${ask}.`,
    "Then remove the marks completely: no trace of the magenta lines may remain in the result.",
    words || "Add no text, letters, numbers or logos unless the note names them.",
    "This image is a close-up of one part of a larger picture. Change only what the marks point at. Keep the same style, light and colours, and keep the outer edge as it is so it joins the rest.",
  ].filter(Boolean).join("\n\n").slice(0, 4000);
}

/**
 * How far an answer's shape may be from the shape asked for and still be used.
 * Within ASPECT_SAME it is resized as it is (rounding to model sizes); within
 * ASPECT_CROP its middle is cut to the asked shape and then resized, so things
 * in it keep their proportions; past that it is refused rather than squashed
 * (PI-24: an answer stretched into the marked area came out distorted).
 */
export const ASPECT_SAME = 0.03;
export const ASPECT_CROP = 0.25;

/** The relative difference between two shapes (width over height), symmetric: 0 is the same shape. */
export function aspectGap(a: { width: number; height: number }, b: { width: number; height: number }): number {
  const ra = a.width / a.height, rb = b.width / b.height;
  return Math.abs(Math.log(ra / rb));
}

/** The answer brought to `width` x `height` without distortion: resized, centre-cropped then resized, or refused. */
export async function toShape(answer: Buffer, width: number, height: number): Promise<ReturnType<typeof sharp>> {
  const meta = await sharp(answer).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw new ProviderError("unparseable", "The picture came back unreadable.");
  const gap = aspectGap(meta, { width, height });
  if (gap > ASPECT_CROP) throw new ProviderError("unparseable", "The picture came back in another shape, so it wasn't used. Try again.");
  if (gap <= ASPECT_SAME) return sharp(answer).resize(width, height, { fit: "fill" });
  // Cut the middle to the asked shape first: cover crops, it never stretches.
  return sharp(answer).resize(width, height, { fit: "cover", position: "centre" });
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

  /**
   * A job given up on is cancelled at Runpod (PI-39): left running it can still
   * finish and be billed while the app has moved on. Best effort: a cancel that
   * fails changes nothing for the caller.
   */
  const cancel = async (model: string, id: string) => {
    await fetchImpl(`${base}/${model}/cancel/${id}`, { method: "POST", headers: auth, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  };

  /** Run one job to the end: runsync answers when done, or hands back an id to wait on. */
  const run = async (model: string, input: Record<string, unknown>, what: string): Promise<string> => {
    const deadline = Date.now() + config.timeoutMs;
    const first = await send(`${base}/${model}/runsync`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ input }) }, what, deadline);
    let job = (await first.json().catch(() => null)) as JobReply | null;
    while (job && (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS") && job.id) {
      const id = job.id;
      if (Date.now() > deadline) {
        await cancel(model, id);
        throw new ProviderError("timeout", `${what} timed out.`, true);
      }
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const next = await send(`${base}/${model}/status/${id}`, { headers: auth }, what, deadline);
        job = (await next.json().catch(() => null)) as JobReply | null;
      } catch (e) {
        if (e instanceof ProviderError && e.kind === "timeout") await cancel(model, id);
        throw e;
      }
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
      const intent = req.intent ?? "area";
      const source = Buffer.from(req.source);
      const meta = await sharp(source).metadata().catch(() => null);
      if (!meta?.width || !meta.height) throw new ProviderError("bad_request", "The picture to change couldn't be read.");
      const { width, height } = meta;
      // The picture travels inline: it is private, and the app may not be reachable from outside.
      const inline = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
      const inputFor = (model: string, prompt: string, image: string) =>
        /2511|kontext|seedream|banana/i.test(model)
          ? { prompt, images: [image], image, seed: -1, output_format: "png" }
          : { prompt, image, negative_prompt: "", seed: -1, output_format: "png", enable_safety_checker: true };

      // A bigger frame: the whole canvas goes (the matte is the area), and the whole answer comes back.
      if (intent === "extend") {
        const model = config.extendModel || config.editModel;
        const canvas = await sharp(source).png().toBuffer();
        const answer = await download(await run(model, inputFor(model, EXTEND_PROMPT, inline(canvas)), "Extending the picture"));
        return asPng(await toShape(answer, width, height), model);
      }

      const model = intent === "erase" ? config.eraseModel || config.editModel : config.editModel;
      const marked = await markedBox(req.mask);
      if (intent === "erase" && !marked) throw new ProviderError("bad_request", "Nothing was brushed over to erase.");
      // Nothing marked (or an unreadable mask): the whole picture is the area.
      const area = !marked ? { left: 0, top: 0, width, height }
        : intent === "erase" ? closeUp(marked, width, height, ERASE_CONTEXT, true)
        : closeUp(marked, width, height, CONTEXT);

      // What the model is shown: the picture, with the drawn marks on it (Markup)
      // or the brushed area painted over (Erase, "tint"). The answer is pasted
      // onto the picture itself, never onto this.
      const eraseVariant = config.eraseVariant ?? ERASE_VARIANT;
      let shown = source;
      try {
        if (intent === "area" && req.marks) {
          const marks = await sharp(Buffer.from(req.marks)).resize(width, height, { fit: "fill" }).ensureAlpha().png().toBuffer();
          shown = await sharp(source).composite([{ input: marks }]).png().toBuffer();
        } else if (intent === "erase" && req.erase === "words") {
          // Shown as it is: the instruction names what goes (ERASE_WORDS_PROMPT).
        } else if (intent === "erase" && eraseVariant === "fill") {
          shown = (await fillBrushed(source, req.mask, width, height)) as typeof shown;
        } else if (intent === "erase" && eraseVariant === "tint") {
          const m = await sharp(Buffer.from(req.mask)).resize(width, height, { fit: "fill", kernel: "nearest" }).ensureAlpha().raw().toBuffer();
          const paint = Buffer.alloc(width * height * 4);
          for (let i = 0; i < width * height; i++) {
            if (m[i * 4 + 3] >= 128) continue;
            paint[i * 4] = TINT.r;
            paint[i * 4 + 1] = TINT.g;
            paint[i * 4 + 2] = TINT.b;
            paint[i * 4 + 3] = TINT.alpha;
          }
          shown = await sharp(source).composite([{ input: paint, raw: { width, height, channels: 4 } }]).png().toBuffer();
        }
      } catch {
        throw new ProviderError("bad_request", "The marks on the picture couldn't be read.");
      }

      // The close-up, enlarged to a size the model draws well at.
      const scale = Math.min(4, WORK_SIDE / Math.max(area.width, area.height));
      const workW = Math.max(64, Math.round((area.width * scale) / 8) * 8);
      const workH = Math.max(64, Math.round((area.height * scale) / 8) * 8);
      const crop = await sharp(shown).extract(area).resize(workW, workH, { fit: "fill" }).png().toBuffer();

      const prompt = intent === "erase"
        ? req.erase === "words" ? ERASE_WORDS_PROMPT : ERASE_PROMPTS[eraseVariant]
        : req.marks ? markupPrompt(req.prompt) : closeUpPrompt(req.prompt, !!marked);
      const answer = await download(await run(model, inputFor(model, prompt, inline(crop)), "Changing the picture"));

      // Back to the close-up's own size and into its place in the full picture.
      // An answer in another shape is cropped to the close-up's shape, never
      // stretched into it (PI-24); one far off is refused (toShape).
      const patch = await (await toShape(answer, area.width, area.height)).png().toBuffer();
      return asPng(sharp(source).composite([{ input: patch, left: area.left, top: area.top }]), model);
    },
  };
}
