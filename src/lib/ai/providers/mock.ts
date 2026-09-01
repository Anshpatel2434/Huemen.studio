/**
 * Deterministic mock providers for local dev and CI (no API keys, no network).
 * They echo the injected brand context so tests can assert that context WAS
 * injected (INV-2). Swap for real providers via env (AI_TEXT_PROVIDER etc.).
 */
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageProvider,
  TextGenRequest,
  TextGenResult,
  TextProvider,
} from "../types";

export const mockTextProvider: TextProvider = {
  name: "mock",
  async generate(req: TextGenRequest, model: string): Promise<TextGenResult> {
    const n = req.variants ?? 2;
    const variants = Array.from({ length: n }, (_, i) => {
      const doWords = req.context.guardrails.doWords.slice(0, 2).join(" / ");
      return [
        `[${req.templateKey} · variant ${i + 1}]`,
        req.taskInput ? `Topic: ${req.taskInput}` : "",
        doWords ? `On-brand words: ${doWords}.` : "",
        req.context.degraded
          ? "(Foundation is thin — output would be more generic.)"
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    });
    return {
      variants,
      model,
      tokensIn: req.context.serialized.length + req.taskInput.length,
      tokensOut: variants.join("").length,
    };
  },
};

export const mockImageProvider: ImageProvider = {
  name: "mock",
  async generate(_req: ImageGenRequest, model: string): Promise<ImageGenResult> {
    // 1x1 transparent PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    return { bytes: new Uint8Array(png), mime: "image/png", model, width: 1, height: 1 };
  },
};
