"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionActor } from "@/lib/auth/workspace";
import { saveBriefAnswers } from "@/lib/data/foundation";
import { generatePillars } from "@/lib/data/pipeline";

/** Getting started › Pillars: the three strategy answers, and pillars made from them and the brief. */
export async function setupPillarsAction(fd: FormData) {
  const tenantId = String(fd.get("tenantId"));
  const { scope } = await actionActor(tenantId);
  const answers = (["known_for", "contrarian", "questions"] as const)
    .map((key) => ({ key, question: key, answer: String(fd.get(key) ?? "").trim() }))
    .filter((a) => a.answer);
  if (answers.length) await saveBriefAnswers(scope, answers);
  const generate = fd.get("intent") === "pillars";
  if (generate) await generatePillars(scope);
  revalidatePath(`/w/${tenantId}`, "layout");
  redirect(`/w/${tenantId}/setup?tab=pillars${generate ? "&made=1" : "&saved=1"}`);
}
