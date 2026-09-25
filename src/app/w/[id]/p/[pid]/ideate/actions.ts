"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionProjectScope } from "@/lib/auth/workspace";
import { setIdeate } from "@/lib/data/projects";
import { unlockStage } from "@/lib/data/projects";

/**
 * Settle what this piece is about, then open the Content step.
 *
 * Ideate is deliberately cheap: a format, a pillar, an angle and a line of
 * topic. It is the only thing that changes from one piece to the next — the
 * brand it is written from was settled once, in onboarding.
 */
export async function setIdeateAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId") ?? "");
  const projectId = String(fd.get("projectId") ?? "");
  const scope = await actionProjectScope(tenantId, projectId);

  const topic = String(fd.get("topic") ?? "").trim();
  await setIdeate(scope, {
    format: String(fd.get("format") ?? "").trim() || null,
    pillarId: String(fd.get("pillarId") ?? "").trim() || null,
    angle: String(fd.get("angle") ?? "").trim() || null,
    ideaId: String(fd.get("ideaId") ?? "").trim() || null,
    topic,
  });

  const base = `/w/${tenantId}/p/${projectId}`;
  if (String(fd.get("next") ?? "") === "content") {
    await unlockStage(scope, "content");
    revalidatePath(base, "layout");
    redirect(`${base}/content`);
  }
  revalidatePath(base, "layout");
}
