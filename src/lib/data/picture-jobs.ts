/**
 * The picture work still queued or running in a project, as the Visual board
 * watches it: which visual each job is changing and what to say on it.
 *
 * The board reads this when it loads, and polls it while it is open, so a
 * change started in another tab (or by another person) shows its "Changing
 * the picture" overlay here too and the new picture arrives without a reload
 * (PI-27).
 *
 * Server-only.
 */
import "server-only";
import { activeJobsFor } from "@/lib/jobs";
import type { ArtboardKind } from "@/lib/visual/design";
import { listVisuals } from "./pipeline";
import { listComments } from "./visual-comments";
import type { ProjectScope } from "./projects";

/** One job the board watches (the client's Watched, without its client-only fields). */
export interface WatchedJob {
  jobId: string;
  contentItemId: string;
  artboard: string;
  label: string;
  done?: string;
}

const ARTBOARD_OF: Record<string, ArtboardKind> = { single: "post", quote_card: "quote", carousel_frame: "carousel" };

export const PICTURE_JOB_KINDS = ["picture_generate", "picture_edit", "picture_resize", "picture_cutout"] as const;

/** Jobs started on a visual by name: a new picture, a resize, a background removal. */
const DIRECT: Record<string, { label: string; done?: string }> = {
  picture_generate: { label: "Drawing a picture" },
  picture_resize: { label: "Resizing the picture", done: "Picture resized. The new part was drawn to match." },
  picture_cutout: { label: "Removing the background", done: "Background removed. The picture now sits on your background colour." },
};

export async function watchedPictureJobs(scope: ProjectScope): Promise<WatchedJob[]> {
  const jobs = await activeJobsFor(scope, [...PICTURE_JOB_KINDS], scope.projectId);
  if (!jobs.length) return [];
  const needsComments = jobs.some((j) => j.kind === "picture_edit");
  const [comments, visuals] = needsComments ? await Promise.all([listComments(scope), listVisuals(scope)]) : [[], []];
  const visualById = new Map(visuals.map((v) => [v.id, v]));
  return jobs.flatMap((j): WatchedJob[] => {
    const d = DIRECT[j.kind];
    if (d) {
      return typeof j.payload.contentItemId === "string" && typeof j.payload.artboard === "string"
        ? [{ jobId: j.id, contentItemId: j.payload.contentItemId, artboard: j.payload.artboard, ...d }]
        : [];
    }
    // Picture changes: one comment (as before the picture tools), or several sent together.
    const ids = Array.isArray(j.payload.commentIds) ? j.payload.commentIds.map(String) : j.payload.commentId ? [String(j.payload.commentId)] : [];
    const c = comments.find((x) => ids.includes(x.id));
    const v = c && visualById.get(c.visualId);
    const n = ids.length;
    return c && v
      ? [{
          jobId: j.id, contentItemId: c.contentItemId, artboard: ARTBOARD_OF[v.kind] ?? "post",
          label: n > 1 ? `Changing the picture (${n} changes)` : "Changing the picture",
          done: n > 1 ? `Picture changed: ${n} changes. Only the marked areas were redrawn.` : "Picture changed. Only the marked area was redrawn.",
        }]
      : [];
  });
}
