/**
 * Remove background: which provider cuts the subject out, and whether it can
 * run here at all. Config, like every model choice (AI_CUTOUT_PROVIDER):
 *
 *   off    (default) the tool shows disabled, with the reason
 *   onnx   the open model inside the app (providers/cutout-onnx); needs the
 *          model file at AI_CUTOUT_MODEL_PATH (npm run models:fetch)
 *   mock   the stand-in, for development and tests
 *
 * Feature code never calls a provider: it calls the facade (lib/ai
 * cutoutImage), which checks the cap and writes the log row.
 *
 * Server-only.
 */
import "server-only";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getEnv, type Env } from "@/lib/env";
import type { CutoutStatus } from "@/lib/visual/picture-tools";
import { AiConfigError } from "./errors";
import type { CutoutProvider } from "./types";
import { mockCutoutProvider } from "./providers/mock";
import { onnxCutoutProvider } from "./providers/cutout-onnx";

/** Plain reasons, shown on the disabled tool. */
export const CUTOUT_OFF = "Background removal isn't switched on for this workspace yet.";
export const CUTOUT_NO_MODEL = "The background model file is missing. Your admin can add it.";

/** Whether Remove background can run here, and why not when it can't. */
export function cutoutStatus(env: Env = getEnv()): CutoutStatus {
  switch (env.AI_CUTOUT_PROVIDER) {
    case "mock":
      return { available: true, reason: null };
    case "onnx":
      return existsSync(resolve(env.AI_CUTOUT_MODEL_PATH)) ? { available: true, reason: null } : { available: false, reason: CUTOUT_NO_MODEL };
    case "off":
      return { available: false, reason: CUTOUT_OFF };
  }
}

/** The provider named in config. Off, or without its model file, is a config error: never a silent stand-in. */
export function selectCutoutProvider(env: Env): CutoutProvider {
  switch (env.AI_CUTOUT_PROVIDER) {
    case "mock":
      return mockCutoutProvider;
    case "onnx":
      if (!existsSync(resolve(env.AI_CUTOUT_MODEL_PATH))) {
        throw new AiConfigError(`AI_CUTOUT_PROVIDER=onnx needs the model file at ${env.AI_CUTOUT_MODEL_PATH}. Run: npm run models:fetch`);
      }
      return onnxCutoutProvider({ modelPath: env.AI_CUTOUT_MODEL_PATH });
    case "off":
      throw new AiConfigError("Background removal is off (AI_CUTOUT_PROVIDER=off). Set it to onnx and fetch the model: npm run models:fetch");
  }
}
