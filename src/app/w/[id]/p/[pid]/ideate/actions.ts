"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionProjectScope } from "@/lib/auth/workspace";
import { setIdeate } from "@/lib/data/projects";
import { listContent } from "@/lib/data/content";
import { unlockStage } from "@/lib/data/projects";
import { saveTopic } from "@/lib/data/create";
import { getIdea } from "@/lib/data/planning";
import { FORMATS } from "@/lib/content/formats";
import { uuidOrNull } from "@/lib/content/ids";

/**
 * Settle what this piece is about, then open the Content step.
 *
 * Ideate is deliberately cheap: a format, a pillar, an angle and a line of
 * topic. It is the only thing that changes from one piece to the next — the
 * brand it is written from was settled once, in onboarding.
 *
 * Everything here arrives from a form, so it is checked before it reaches the
 * database: a format that isn't one, or a pillar or idea id that isn't an id
 * (or isn't this workspace's), is left out rather than raised as an error.
 */
export async function setIdeateAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId") ?? "");
  const projectId = String(fd.get("projectId") ?? "");
  const scope = await actionProjectScope(tenantId, projectId);

  const format = String(fd.get("format") ?? "").trim();
  const ideaId = uuidOrNull(String(fd.get("ideaId") ?? "").trim());
  await setIdeate(scope, {
    format: FORMATS.some((f) => f.key === format) ? format : null,
    // A pillar that isn't the workspace's is ignored by the update itself (RLS + its own lookup).
    pillarId: uuidOrNull(String(fd.get("pillarId") ?? "").trim()),
    angle: String(fd.get("angle") ?? "").trim().slice(0, 300) || null,
    // Only an idea that is really in this workspace is linked.
    ideaId: ideaId && (await getIdea(scope, ideaId)) ? ideaId : null,
    // The topic is saved below, whole: the name is cut at a word, never mid-word.
    topic: "",
  });
  await saveTopic(scope, String(fd.get("topic") ?? ""));

  const base = `/w/${tenantId}/p/${projectId}`;
  if (String(fd.get("next") ?? "") === "content") {
    await unlockStage(scope, "content");
    revalidatePath(base, "layout");
    // A piece that already has copy still gets the "how do you want to write
    // it" choice for the new topic; the new draft joins the board.
    const hasCopy = (await listContent(scope)).length > 0;
    redirect(`${base}/content${hasCopy ? "?write=1" : ""}`);
  }
  revalidatePath(base, "layout");
}
