/**
 * Provider-agnostic AI layer contracts (brief §05).
 *
 * ONE interface for text, ONE for image. Model choice + params are CONFIG, never
 * hardcoded in feature code. Feature code calls the facade in ./index; it never
 * imports a concrete provider. Retry/fallback policy lives once at the facade.
 */
import type { BrandContext } from "@/lib/context/context-builder";
import type { AssembledPrompt } from "./prompt";
import type { ZodType } from "zod";

/** Route short/cheap tasks (hooks, tags) vs. strong drafting (§09). */
export type TextRoute = "strong" | "cheap";

export interface TextGenRequest {
  /** prompt_templates key resolved to a system template (INV-2). */
  templateKey: string;
  /** The single versioned brand context block (INV-2). */
  context: BrandContext;
  /** Task-specific input (topic, idea, steer, etc.). */
  taskInput: string;
  route?: TextRoute;
  /** Number of variants to return (brief §4.2: 2–3). */
  variants?: number;
  /**
   * Pictures the model looks at alongside the task (vision). Already
   * downscaled by the caller (lib/visual/look-read); at most MAX_TASK_IMAGES.
   * A request with images runs on the vision model (AI_VISION_MODEL).
   */
  images?: TextImage[];
}

/** One picture sent with a text request. JPEG, PNG or WebP bytes. */
export interface TextImage {
  mime: "image/jpeg" | "image/png" | "image/webp";
  data: Uint8Array;
}

/** The most pictures one request may carry. */
export const MAX_TASK_IMAGES = 3;

export interface TextGenResult {
  variants: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** The picture's shape. Providers map it to a size they support; the visual crops to its frame. */
export type ImageShape = "square" | "portrait" | "landscape";

export interface ImageGenRequest {
  context: BrandContext;
  /** Task description of the desired image (written by the image_brief task, INV-2). */
  prompt: string;
  shape?: ImageShape;
  aspectRatio?: string;
  /** Negative prompt to fight the generic AI look (brief §4.3). */
  negativePrompt?: string;
}

/**
 * Redraw one area of a picture. `mask` is a PNG the same size as `source`:
 * transparent where the picture may change, opaque elsewhere. Providers treat
 * it as guidance, so the caller composites the result back over the original
 * outside the area (lib/visual/region) and nothing else can move.
 *
 * `intent` says what the change is, so each provider can word it its own way:
 *
 *   "area"    (default) redraw the masked area as the prompt asks. With
 *             `marks` (a transparent PNG the size of `source`, hand-drawn
 *             lines on it) the model is shown the marks on the picture and
 *             told to follow them and the note, then remove them.
 *   "erase"   remove what is in the masked (brushed) area and fill it with
 *             what is around it. The prompt is the provider's own.
 *   "extend"  `source` is the picture already set in a bigger frame on a flat
 *             green matte; the mask marks the matte. The model fills the
 *             matte so the scene carries on, and changes nothing else.
 */
export type ImageEditIntent = "area" | "erase" | "extend";

export interface ImageEditRequest {
  context: BrandContext;
  prompt: string;
  source: Uint8Array;
  mask: Uint8Array;
  shape?: ImageShape;
  intent?: ImageEditIntent;
  marks?: Uint8Array;
  /**
   * An erase of the WORDS in the masked area, not of everything there
   * (lib/data/pictures keepWordsOut): the model is told to remove writing
   * only, so a box where a vision model saw words that aren't there comes
   * back as it was instead of being painted over.
   */
  erase?: "words";
}

export interface ImageGenResult {
  /** Raw bytes; the caller persists to tenant-prefixed storage. */
  bytes: Uint8Array;
  mime: string;
  model: string;
  width?: number;
  height?: number;
}

/** Thinking depth, where the model supports it. Config, never chosen in feature code. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface TextCallOptions {
  /** Omitted when unset: some models reject the parameter outright. */
  effort?: Effort;
  /**
   * Sampling temperature (audit M1). Low for a judgement or a rewrite, so a
   * rerun gives the same answer; moderate for a draft. Chosen by the facade
   * (lib/ai/index: TEMPERATURE), never by feature code. Omitted when unset.
   * A provider omits it where the model would reject it (see anthropic.ts).
   */
  temperature?: number;
}

export interface TextProvider {
  readonly name: string;
  /**
   * `prompt` is the assembled system + user pair from lib/ai/prompt (INV-2).
   * A provider must send THAT, never rebuild a prompt of its own from
   * `context` and `taskInput` — that is how two modules end up describing the
   * same brand two different ways.
   */
  generate(
    req: TextGenRequest & { prompt: AssembledPrompt },
    model: string,
    opts?: TextCallOptions,
  ): Promise<TextGenResult>;
  /**
   * A task whose answer is DATA, not prose: topic proposals, check findings,
   * a rewrite. The schema is enforced by the provider (structured output) and
   * re-validated here, so a caller never handles a half-shaped reply.
   */
  structured<T>(
    req: TextGenRequest & { prompt: AssembledPrompt },
    model: string,
    schema: ZodType<T>,
    opts?: TextCallOptions,
  ): Promise<StructuredResult<T>>;
}

/**
 * A draft as it is written (brief §07: "anything the user waits on streams").
 * Deltas are plain text; versions are separated by a line holding only
 * STREAM_SEPARATOR (lib/ai/prompt), so the canvas can show each version
 * filling in. The last event is always "done", carrying the usage to log.
 */
export type TextStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      model: string;
      tokensIn: number;
      tokensOut: number;
      /** The final text, when the provider knows it better than the deltas (a mid-stream fallback). */
      text?: string;
    };

export interface StreamingTextProvider extends TextProvider {
  stream(
    req: TextGenRequest & { prompt: AssembledPrompt },
    model: string,
    opts?: TextCallOptions,
  ): AsyncIterable<TextStreamEvent>;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageGenRequest, model: string): Promise<ImageGenResult>;
  edit(req: ImageEditRequest, model: string): Promise<ImageGenResult>;
}

/**
 * A picture with its background removed (Remove background on the Visual
 * board): a PNG with alpha, the model that made the matte, and `coverage`,
 * the share of the picture that is subject (0..1). The caller refuses a
 * cut-out with no clear subject (lib/visual/picture-tools clearSubject).
 */
export interface CutoutResult {
  bytes: Uint8Array;
  model: string;
  coverage: number;
}

/** Background removal runs inside the app (an open model, no cost per use), behind the same facade. */
export interface CutoutProvider {
  readonly name: string;
  cutout(source: Uint8Array): Promise<CutoutResult>;
}
