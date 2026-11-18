/**
 * What each kind of job does. A handler gets the starter's scope (re-checked
 * for access before every slice), its payload and the progress so far, and
 * returns { done: true, result } or { done: false } to be called again.
 *
 * Handlers save progress BEFORE the slow step that might fail, so a retry
 * carries on instead of starting over (a piece created for a pillar is reused,
 * never made twice).
 *
 * Server-only.
 */
import "server-only";
import { listPillars, generateCalendar } from "@/lib/data/planning";
import { startPiece } from "@/lib/data/create";
import { generateContent } from "@/lib/data/content";
import { scoreProject } from "@/lib/data/check";
import { unlockStage } from "@/lib/data/projects";
import { getProject, type ProjectScope } from "@/lib/data/projects";
import { cutOutPicture, drawPicture, PictureError, resizePicture } from "@/lib/data/pictures";
import { applyPictureComment, CommentError, failWaitingComments, finishComment } from "@/lib/data/visual-comments";
import { ARTBOARDS, type ArtboardKind } from "@/lib/visual/design";
import { MAX_PINS_PER_SEND, type ResizeInput } from "@/lib/visual/picture-tools";
import { getEnv } from "@/lib/env";
import type { SessionScope } from "@/db/session";
import { JobStop, type JobHandler } from "./types";

/**
 * Leave room for one more model call (AI_TEXT_TIMEOUT_MS defaults to 120s)
 * before the deadline. Every slice does at least one unit of work, so a short
 * budget can never spin a job without progress.
 */
const ROOM_FOR_ONE_CALL_MS = 130_000;

export interface PillarDraftItem {
  pillarId: string;
  name: string;
  projectId: string | null;
  drafted: boolean;
}

export interface PillarDraftsProgress {
  items: PillarDraftItem[];
}

/** One drafted piece per pillar, each its own project (the client's rule: one output per project). */
const pillarDrafts: JobHandler = async ({ scope, payload, progress, save, deadline }) => {
  const format = typeof payload.format === "string" ? payload.format : "linkedin_post";
  let items = (progress as Partial<PillarDraftsProgress>).items;
  if (!items) {
    const wanted = Array.isArray(payload.pillarIds) ? (payload.pillarIds as string[]) : null;
    const pillars = (await listPillars(scope)).filter((p) => !wanted || wanted.includes(p.id));
    if (pillars.length === 0) throw new JobStop("There are no pillars to draft from.");
    items = pillars.map((p) => ({ pillarId: p.id, name: p.name, projectId: null, drafted: false }));
    await save({ items });
  }
  const pillars = new Map((await listPillars(scope)).map((p) => [p.id, p]));
  let didOne = false;
  for (const item of items) {
    if (item.drafted) continue;
    if (didOne && Date.now() > deadline - ROOM_FOR_ONE_CALL_MS) return { done: false };
    const pillar = pillars.get(item.pillarId);
    if (!pillar) {
      // Deleted since the job started: nothing to draft, not a failure.
      item.drafted = true;
      await save({ items });
      continue;
    }
    if (!item.projectId) {
      item.projectId = await startPiece(scope, {
        topic: `${pillar.name}: ${pillar.description ?? "what I've learned"}`,
        format,
        pillarName: pillar.name,
      });
      await save({ items });
    }
    const ps = { ...scope, projectId: item.projectId };
    await generateContent(ps, { format, topic: pillar.name, pillarId: pillar.id });
    await scoreProject(ps).catch(() => undefined);
    await unlockStage(ps, "content");
    item.drafted = true;
    didOne = true;
    await save({ items });
  }
  const made = items.filter((i) => i.drafted && i.projectId);
  return { done: true, result: { drafted: made.length, projectIds: made.map((i) => i.projectId) } };
};

/** The 90-day plan: one model call that fills every free slot. */
const calendarPlan: JobHandler = async ({ scope, payload }) => {
  const start = String(payload.start ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new JobStop("The plan needs a start date.");
  const perWeek = Math.min(7, Math.max(1, Number(payload.perWeek ?? 3)));
  const channels = Array.isArray(payload.channels) ? (payload.channels as string[]) : [];
  const out = await generateCalendar(scope, { start, perWeek, channels });
  return { done: true, result: out };
};

/** The project a picture job works in, checked to still be there and visible to its starter. */
async function projectOf(scope: SessionScope & { tenantId: string }, payload: Record<string, unknown>): Promise<ProjectScope> {
  const projectId = String(payload.projectId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !(await getProject(scope, projectId))) throw new JobStop("That project isn't there any more.");
  return { ...scope, projectId };
}

const artboardOf = (v: unknown): ArtboardKind => {
  if (!ARTBOARDS.includes(v as ArtboardKind)) throw new JobStop("That visual isn't one that takes a picture.");
  return v as ArtboardKind;
};

/** A new picture for one visual: Claude writes the brief, the image model draws it. */
const pictureGenerate: JobHandler = async ({ scope, payload, progress, save }) => {
  if (typeof progress.pictureId === "string") return { done: true, result: { pictureId: progress.pictureId } };
  const ps = await projectOf(scope, payload);
  const id = await drawPicture(ps, String(payload.contentItemId ?? ""), artboardOf(payload.artboard), payload.mode === "with_text" ? "with_text" : "live_text");
  await save({ pictureId: id });
  return { done: true, result: { pictureId: id } };
};

/** The pins a picture_edit job runs, in order: `commentIds` (one Send, several pins) or the older single `commentId`. */
export function pinIdsOf(payload: Record<string, unknown>): string[] {
  const many = Array.isArray(payload.commentIds) ? payload.commentIds : null;
  const ids = (many ?? [payload.commentId]).filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v));
  return [...new Set(ids)].slice(0, MAX_PINS_PER_SEND);
}

export interface PictureEditProgress {
  /** Pins that went through, and the picture version each one made. */
  done: Record<string, string>;
  /** Pins that could not be done, and why (the pin on the board says the same). */
  failed: Record<string, string>;
  /** The newest version made, for the board to show. */
  last: string | null;
}

/**
 * The pins of one Send on a picture, one after the other: each redraws its
 * own area (or follows its marks, or erases its brushed area) starting from
 * the result of the one before, so the last version carries them all.
 *
 * Progress is saved after every pin, so a retry or the next slice never does
 * a pin twice (each is a picture charge). A pin that can't be done (its
 * picture is gone, there is nothing to change) fails on its own, with the
 * reason on the pin, and the rest still run. A provider failure stops the
 * slice and throws, so the queue's own retry and backoff apply; if the job
 * then stops for good, JOB_ON_STOP tells every pin that is still waiting.
 *
 * The payload of a comment queued before several pins existed
 * ({ commentId, area }) still runs.
 */
const pictureEdit: JobHandler = async ({ scope, payload, progress, save, deadline }) => {
  const ps = await projectOf(scope, payload);
  const ids = pinIdsOf(payload);
  if (ids.length === 0) throw new JobStop("That comment isn't there any more.");
  const state: PictureEditProgress = {
    done: { ...((progress.done ?? {}) as Record<string, string>) },
    failed: { ...((progress.failed ?? {}) as Record<string, string>) },
    last: typeof progress.last === "string" ? progress.last : null,
  };
  // A job that ran before progress had this shape: its one pin is done.
  if (typeof progress.pictureId === "string" && ids.length === 1) state.done[ids[0]] = state.last = progress.pictureId;
  const legacyArea = ids.length === 1 && !Array.isArray(payload.commentIds) ? ((payload.area ?? null) as Record<string, number> | null) : null;
  const room = getEnv().AI_IMAGE_TIMEOUT_MS + 10_000;
  let didOne = false;
  for (const id of ids) {
    if (state.done[id] || state.failed[id]) continue;
    if (didOne && Date.now() > deadline - room) return { done: false };
    try {
      const pictureId = await applyPictureComment(ps, id, legacyArea);
      state.done[id] = pictureId;
      state.last = pictureId;
    } catch (e) {
      // Only what no retry can fix is the pin's own failure; anything else is the queue's to retry.
      if (!(e instanceof CommentError) && !(e instanceof PictureError)) throw e;
      state.failed[id] = e.message;
      await finishComment(ps, id, { status: "failed", result: e.message }).catch(() => undefined);
    }
    didOne = true;
    await save({ ...state });
  }
  // Nothing went through: the job says so (the pins already carry their own reasons).
  if (!state.last) throw new JobStop(Object.values(state.failed).at(-1) ?? "That change couldn't be made.");
  return { done: true, result: { pictureId: state.last, changed: Object.keys(state.done).length, failed: Object.keys(state.failed).length } };
};

/** A refusal with a plain reason (a picture that is gone, a shape that can't be made) stops the job at once with that reason. */
async function plainly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof PictureError) throw new JobStop(e.message);
    throw e;
  }
}

/** A new shape for one visual's picture where the image model has to draw the extra area. */
const pictureResize: JobHandler = async ({ scope, payload, progress, save }) => {
  if (typeof progress.pictureId === "string") return { done: true, result: { pictureId: progress.pictureId } };
  const ps = await projectOf(scope, payload);
  const input = (payload.input ?? {}) as ResizeInput;
  const id = await plainly(() => resizePicture(ps, String(payload.contentItemId ?? ""), artboardOf(payload.artboard), input));
  await save({ pictureId: id });
  return { done: true, result: { pictureId: id } };
};

/** The background removed from one visual's picture (the model runs here, on this server). */
const pictureCutout: JobHandler = async ({ scope, payload, progress, save }) => {
  if (typeof progress.pictureId === "string") return { done: true, result: { pictureId: progress.pictureId } };
  const ps = await projectOf(scope, payload);
  const id = await plainly(() => cutOutPicture(ps, String(payload.contentItemId ?? ""), artboardOf(payload.artboard)));
  await save({ pictureId: id });
  return { done: true, result: { pictureId: id } };
};

export const JOB_HANDLERS = {
  pillar_drafts: pillarDrafts,
  calendar_plan: calendarPlan,
  picture_generate: pictureGenerate,
  picture_edit: pictureEdit,
  picture_resize: pictureResize,
  picture_cutout: pictureCutout,
} satisfies Record<string, JobHandler>;

export type JobKind = keyof typeof JOB_HANDLERS;

/** Called once when a job stops for good (failed or dead), with the plain reason. */
export const JOB_ON_STOP: Partial<Record<JobKind, (scope: SessionScope & { tenantId: string }, payload: Record<string, unknown>, message: string) => Promise<void>>> = {
  // Every pin of the Send that is still waiting says why; the ones done, or failed for their own reason, keep what they say.
  picture_edit: async (scope, payload, message) => {
    const projectId = String(payload.projectId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) return;
    await failWaitingComments({ ...scope, projectId }, pinIdsOf(payload), message);
  },
};
