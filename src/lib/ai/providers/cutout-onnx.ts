/**
 * Background removal inside the app: the ISNet general-use model (the one
 * rembg calls "isnet-general-use", Apache-2.0) run on the CPU with
 * onnxruntime-node (MIT). No service and no cost per use; the model is a file
 * on the server (AI_CUTOUT_MODEL_PATH, fetched once by `npm run models:fetch`).
 *
 * The steps are the model's reference implementation (rembg's
 * dis_general_use session), with sharp doing the image work:
 *
 *   in    the picture as RGB, resized to 1024 x 1024 (Lanczos), scaled to
 *         0..1 by its own brightest value, then (value - 0.5) / 1.0 per
 *         channel, laid out channel-first as one float32 tensor [1, 3, 1024, 1024]
 *   out   the first output, [1, 1, 1024, 1024]: the matte. It is stretched
 *         to its own lowest and highest value (min-max), resized back to the
 *         picture's size (Lanczos) and used as the picture's alpha.
 *
 * onnxruntime-node is loaded only when a cut-out is asked for, so the app
 * starts (and every other feature works) on a host that does not have it.
 * The session is opened once per process and reused; cut-outs run one at a
 * time, because one run already uses every core and about a gigabyte.
 *
 * Measured on the development PC (2026-11-18, one 1024 x 1280 picture, CPU):
 * about 6 s for the first cut-out (it opens the model), 2 to 4 s after that;
 * about 1.0 GB at the most while it works, about 300 MB held afterwards. With
 * the runtime's memory arena left on it was a little faster but held 1.6 GB
 * for as long as the server ran, so the arena is off (SESSION_OPTIONS).
 * `npm run smoke:cutout` prints the same numbers on any host.
 *
 * Server-only.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { AiConfigError, ProviderError } from "../errors";
import type { CutoutProvider, CutoutResult } from "../types";

export const CUTOUT_MODEL_NAME = "cutout:isnet-general-use";
/** The side of the square the model works at. */
const SIDE = 1024;
/** CPU only (no GPU needed or looked for). The memory arena is off so a run's working memory is given back afterwards. */
const SESSION_OPTIONS = { executionProviders: ["cpu"], graphOptimizationLevel: "all", enableCpuMemArena: false };

/** The few parts of onnxruntime-node used here (its own types load only with the package). */
interface OrtTensor { data: Float32Array | ArrayLike<number>; dims: readonly number[] }
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface Ort {
  InferenceSession: { create(path: string, options?: Record<string, unknown>): Promise<OrtSession> };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
}

let ortModule: Promise<Ort> | null = null;
const sessions = new Map<string, Promise<OrtSession>>();
/** One run at a time in this process. */
let queue: Promise<unknown> = Promise.resolve();

async function loadOrt(): Promise<Ort> {
  ortModule ??= (async () => {
    try {
      const mod = (await import("onnxruntime-node")) as unknown as Ort & { default?: Ort };
      return mod.default?.InferenceSession ? mod.default : mod;
    } catch {
      throw new AiConfigError("AI_CUTOUT_PROVIDER=onnx needs the onnxruntime-node package installed on this server (npm install).");
    }
  })();
  return ortModule.catch((e) => {
    ortModule = null;
    throw e;
  });
}

async function sessionFor(path: string): Promise<{ ort: Ort; session: OrtSession }> {
  const ort = await loadOrt();
  if (!existsSync(path)) throw new AiConfigError(`The background model file is missing at ${path}. Run: npm run models:fetch`);
  let opened = sessions.get(path);
  if (!opened) {
    opened = ort.InferenceSession.create(path, SESSION_OPTIONS);
    sessions.set(path, opened);
    opened.catch(() => sessions.delete(path));
  }
  return { ort, session: await opened };
}

/** The picture as the model's input tensor data: channel-first float32, 0..1 by its own maximum, minus 0.5. */
export async function cutoutInput(source: Uint8Array): Promise<Float32Array> {
  const rgb = await sharp(Buffer.from(source)).removeAlpha().toColourspace("srgb").resize(SIDE, SIDE, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  let max = 0;
  for (let i = 0; i < rgb.length; i++) if (rgb[i] > max) max = rgb[i];
  const scale = 1 / Math.max(max, 1e-6);
  const plane = SIDE * SIDE;
  const data = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    data[p] = rgb[p * 3] * scale - 0.5;
    data[plane + p] = rgb[p * 3 + 1] * scale - 0.5;
    data[2 * plane + p] = rgb[p * 3 + 2] * scale - 0.5;
  }
  return data;
}

/**
 * The model's matte (SIDE x SIDE values, any range) as the picture's alpha:
 * min-max stretched, resized to the picture, joined to its colours. Returns
 * the PNG and the share of the picture that is kept.
 */
export async function applyMatte(source: Uint8Array, matte: ArrayLike<number>): Promise<{ bytes: Uint8Array; coverage: number }> {
  const plane = SIDE * SIDE;
  if (matte.length < plane) throw new ProviderError("unparseable", "The background model's answer was the wrong size.");
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = matte[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  const grey = Buffer.alloc(plane);
  // A flat matte has nothing in it: all background, never a divide by zero.
  if (span > 1e-9) for (let i = 0; i < plane; i++) grey[i] = Math.round(((matte[i] - lo) / span) * 255);
  const { data: rgb, info } = await sharp(Buffer.from(source)).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  // extractChannel: sharp hands a one-channel picture back as three unless told which one is wanted.
  const alpha = await sharp(grey, { raw: { width: SIDE, height: SIDE, channels: 1 } })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const out = Buffer.alloc(width * height * 4);
  let kept = 0;
  for (let p = 0; p < width * height; p++) {
    out[p * 4] = rgb[p * 3];
    out[p * 4 + 1] = rgb[p * 3 + 1];
    out[p * 4 + 2] = rgb[p * 3 + 2];
    out[p * 4 + 3] = alpha[p];
    if (alpha[p] >= 128) kept++;
  }
  const png = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { bytes: new Uint8Array(png), coverage: kept / (width * height) };
}

export function onnxCutoutProvider(config: { modelPath: string }): CutoutProvider {
  const path = resolve(config.modelPath);
  return {
    name: "onnx",
    async cutout(source: Uint8Array): Promise<CutoutResult> {
      const run = async (): Promise<CutoutResult> => {
        const { ort, session } = await sessionFor(path);
        const input = await cutoutInput(source).catch(() => {
          throw new ProviderError("bad_request", "The picture couldn't be read.");
        });
        let matte: OrtTensor | undefined;
        try {
          const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIDE, SIDE]) };
          matte = (await session.run(feeds))[session.outputNames[0]];
        } catch (e) {
          throw new ProviderError("bad_request", `The background model failed: ${e instanceof Error ? e.message.slice(0, 200) : "no reason given"}`);
        }
        if (!matte) throw new ProviderError("unparseable", "The background model gave no answer.");
        return { ...(await applyMatte(source, matte.data)), model: CUTOUT_MODEL_NAME };
      };
      const mine = queue.then(run, run);
      queue = mine.catch(() => undefined);
      return mine;
    },
  };
}
