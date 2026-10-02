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
}

export interface TextGenResult {
  variants: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ImageGenRequest {
  context: BrandContext;
  /** Task description of the desired image. */
  prompt: string;
  aspectRatio?: string;
  /** Negative prompt to fight the generic AI look (brief §4.3). */
  negativePrompt?: string;
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

export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageGenRequest, model: string): Promise<ImageGenResult>;
}
