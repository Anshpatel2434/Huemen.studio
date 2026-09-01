/**
 * Provider-agnostic AI layer contracts (brief §05).
 *
 * ONE interface for text, ONE for image. Model choice + params are CONFIG, never
 * hardcoded in feature code. Feature code calls the facade in ./index; it never
 * imports a concrete provider. Retry/fallback policy lives once at the facade.
 */
import type { BrandContext } from "@/lib/context/context-builder";

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

export interface TextProvider {
  readonly name: string;
  generate(req: TextGenRequest, model: string): Promise<TextGenResult>;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageGenRequest, model: string): Promise<ImageGenResult>;
}
