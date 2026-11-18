/**
 * Looking for words in a picture that must have none (picture_text_check,
 * vision, through the facade: cap, template, retry and the generation_logs
 * row all apply, like look_read). lib/data/pictures decides what to do with
 * the answer (erase, check again, redraw once, or keep and say so).
 *
 * The check never stands in a picture's way: when the vision model is not
 * set up, refuses, is rate limited for longer than a short wait, or answers
 * nonsense, it is logged (picture_text_check_skipped, at info: an expected
 * outcome, not an error) and the picture goes on as drawn. A per-minute
 * limit that clears within WAIT_MAX_S is waited out once (this runs in the
 * job queue, never in a request).
 *
 * Server-only.
 */
import "server-only";
import sharp from "sharp";
import { runTask } from "@/lib/ai";
import { pictureTextCheck } from "@/lib/ai/tasks";
import { ProviderError, RateLimitError } from "@/lib/ai/errors";
import type { BrandContext } from "@/lib/context/context-builder";
import { forVision } from "@/lib/visual/look-read";
import { wordBoxes } from "@/lib/visual/picture-words";
import type { Box } from "@/lib/visual/region-types";
import { logger } from "@/lib/observability/log";
import type { ProjectScope } from "./projects";

/** The longest per-minute wait the check sits out before giving up (seconds). */
const WAIT_MAX_S = 45;

export interface WordsFound {
  hasText: boolean;
  /** Where, as shares of the picture, grown to cover each word whole (lib/visual/picture-words). */
  boxes: Box[];
}

/** How long a refusal says to wait, when it is a short per-minute limit worth sitting out; null otherwise. */
function shortWait(e: unknown): number | null {
  if (e instanceof RateLimitError) return e.retryAfterSeconds <= WAIT_MAX_S ? Math.max(1, e.retryAfterSeconds) : null;
  if (e instanceof ProviderError && e.kind === "rate_limit" && e.limit.window !== "day") {
    const s = e.limit.retryAfterSeconds ?? 10;
    return s <= WAIT_MAX_S ? s : null;
  }
  return null;
}

/**
 * Ask the vision model whether `bytes` shows any text, and where. Null when
 * it could not say (logged with `why`); the caller then keeps the picture.
 */
export async function lookForWords(
  scope: ProjectScope,
  bytes: Uint8Array,
  opts: { context: BrandContext; contentItemId: string | null; why: string; wait?: (ms: number) => Promise<void> },
): Promise<WordsFound | null> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let sent: { width: number; height: number };
  let image: Awaited<ReturnType<typeof forVision>>;
  let aspect = 1;
  try {
    const meta = await sharp(Buffer.from(bytes)).metadata();
    aspect = meta.width && meta.height ? meta.width / meta.height : 1;
    image = await forVision(bytes);
    const m = await sharp(Buffer.from(image.data)).metadata();
    sent = { width: m.width ?? 0, height: m.height ?? 0 };
  } catch (e) {
    logger.info("picture_text_check_skipped", { tenantId: scope.tenantId, why: opts.why, reason: e instanceof Error ? e.message : String(e) });
    return null;
  }
  const ask = () =>
    runTask(scope, pictureTextCheck, {
      context: opts.context,
      contentItemId: opts.contentItemId,
      // No pixel size here: the boxes are asked for in thousandths, and a size invites pixels.
      taskInput: `Picture: ${opts.why}. It should have no words at all.`,
      images: [image],
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const said = await ask();
      const boxes = wordBoxes(said.boxes, sent, aspect);
      // "Text" with nowhere to point at is still text: the board says so, nothing is erased blind.
      return { hasText: said.hasText || boxes.length > 0, boxes };
    } catch (e) {
      const s = attempt === 0 ? shortWait(e) : null;
      if (s !== null) {
        await wait(s * 1000);
        continue;
      }
      logger.info("picture_text_check_skipped", { tenantId: scope.tenantId, why: opts.why, reason: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }
  return null;
}
