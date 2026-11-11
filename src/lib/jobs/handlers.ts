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
import { drawPicture } from "@/lib/data/pictures";
import { applyPictureComment, finishComment } from "@/lib/data/visual-comments";
import { ARTBOARDS, type ArtboardKind } from "@/lib/visual/design";
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

/** One comment on a picture: redraw only its box. */
const pictureEdit: JobHandler = async ({ scope, payload, progress, save }) => {
  if (typeof progress.pictureId === "string") return { done: true, result: { pictureId: progress.pictureId } };
  const ps = await projectOf(scope, payload);
  const id = await applyPictureComment(ps, String(payload.commentId ?? ""));
  await save({ pictureId: id });
  return { done: true, result: { pictureId: id } };
};

export const JOB_HANDLERS = {
  pillar_drafts: pillarDrafts,
  calendar_plan: calendarPlan,
  picture_generate: pictureGenerate,
  picture_edit: pictureEdit,
} satisfies Record<string, JobHandler>;

export type JobKind = keyof typeof JOB_HANDLERS;

/** Called once when a job stops for good (failed or dead), with the plain reason. */
export const JOB_ON_STOP: Partial<Record<JobKind, (scope: SessionScope & { tenantId: string }, payload: Record<string, unknown>, message: string) => Promise<void>>> = {
  picture_edit: async (scope, payload, message) => {
    const projectId = String(payload.projectId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) return;
    await finishComment({ ...scope, projectId }, String(payload.commentId ?? ""), { status: "failed", result: message });
  },
};
