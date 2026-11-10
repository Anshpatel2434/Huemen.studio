"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionActor } from "@/lib/auth/workspace";
import { saveBriefAnswers } from "@/lib/data/foundation";
import { tryGeneratePillars } from "@/lib/data/pipeline";
import { loadBrandContext } from "@/lib/context/context-loader";
import { MIN_SEEDS, STRATEGY } from "@/lib/brief/questions";

/**
 * Getting started › Pillars: the three strategy answers, and pillars made from
 * them and the brief. The same questions, stored the same way and held to the
 * same bar as Brand core › Questions (brand/actions answerQuestionsAction):
 * pillars need at least MIN_SEEDS answers and a brief that isn't too thin.
 */
export async function setupPillarsAction(fd: FormData) {
  const tenantId = String(fd.get("tenantId"));
  const { scope } = await actionActor(tenantId);
  const answers = STRATEGY
    .map((q) => ({ key: q.key, question: q.question, answer: String(fd.get(q.key) ?? "").trim() }))
    .filter((a) => a.answer);
  if (answers.length) await saveBriefAnswers(scope, answers);
  const generate = fd.get("intent") === "pillars";
  if (generate) {
    const context = await loadBrandContext(scope);
    if (context.degraded || answers.length < MIN_SEEDS) {
      revalidatePath(`/w/${tenantId}`, "layout");
      redirect(`/w/${tenantId}/setup?tab=pillars&blocked=1`);
    }
    // Answers are saved above; a failed generation comes back here with Try again.
    const failed = await tryGeneratePillars(scope);
    if (failed) {
      revalidatePath(`/w/${tenantId}`, "layout");
      redirect(`/w/${tenantId}/setup?${new URLSearchParams({ tab: "pillars", failed: failed.slice(0, 300) })}`);
    }
  }
  revalidatePath(`/w/${tenantId}`, "layout");
  redirect(`/w/${tenantId}/setup?tab=pillars${generate ? "&made=1" : "&saved=1"}`);
}
