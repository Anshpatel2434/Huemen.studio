"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionProjectScope } from "@/lib/auth/workspace";
import {
  addCalendarEntry, archiveIdea, captureIdea, createOffer, deleteCalendarEntry, deleteOffer,
  getIdea, markIdeaConverted, setIdeaPillar,
} from "@/lib/data/planning";
import { generateContent } from "@/lib/data/content";
import { unlockStage } from "@/lib/data/projects";

/** Every form posts tenantId + projectId; access is re-checked server-side. */
async function ctx(fd: FormData) {
  const t = String(fd.get("tenantId"));
  const p = String(fd.get("projectId"));
  return { t, p, scope: await actionProjectScope(t, p), base: `/w/${t}/p/${p}` };
}

export async function captureIdeaAction(fd: FormData) {
  const { scope, base } = await ctx(fd);
  const text = String(fd.get("text") ?? "").trim();
  if (text) await captureIdea(scope, text);
  revalidatePath(base, "layout");
}

export async function setIdeaPillarAction(fd: FormData) {
  const { scope, base } = await ctx(fd);
  await setIdeaPillar(scope, String(fd.get("id")), String(fd.get("pillarId") ?? "") || null);
  revalidatePath(base, "layout");
}

export async function archiveIdeaAction(fd: FormData) {
  const { scope, base } = await ctx(fd);
  await archiveIdea(scope, String(fd.get("id")));
  revalidatePath(base, "layout");
}

/** One-click convert: idea → drafted content_item, linked back (brief §4.5). */
export async function convertIdeaAction(fd: FormData) {
  const { scope, base } = await ctx(fd);
  const idea = await getIdea(scope, String(fd.get("id")));
  if (!idea) return;
  const itemId = await generateContent(scope, { format: String(fd.get("format") ?? "linkedin_post"), topic: idea.raw_text, pillarId: idea.pillar_id });
  await markIdeaConverted(scope, idea.id, itemId);
  await unlockStage(scope, "content").catch(() => undefined); // only unlocks if pillars are already done
  revalidatePath(base, "layout");
  redirect(`${base}/content?item=${itemId}`);
}

export async function addCalendarEntryAction(fd: FormData) {
  const { scope, base } = await ctx(fd);
  const date = String(fd.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  await addCalendarEntry(scope, {
    date,
    pillarId: String(fd.get("pillarId") ?? "") || null,
    channel: String(fd.get("channel") ?? ""),
    topic: String(fd.get("topic") ?? ""),
    hookAngle: String(fd.get("hookAngle") ?? ""),
    cta: String(fd.get("cta") ?? ""),
  });
  revalidatePath(base, "layout");
}

export async function deleteCalendarEntryAction(fd: FormData) {
  const { scope, base } = await ctx(fd);
  await deleteCalendarEntry(scope, String(fd.get("id")));
  revalidatePath(base, "layout");
}

export async function createOfferAction(fd: FormData) {
  const { scope, base } = await ctx(fd);
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  await createOffer(scope, {
    name,
    format: String(fd.get("format") ?? ""),
    promise: String(fd.get("promise") ?? ""),
    deliverables: String(fd.get("deliverables") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    pricingLogic: String(fd.get("pricingLogic") ?? ""),
  });
  revalidatePath(base, "layout");
}

export async function deleteOfferAction(fd: FormData) {
  const { scope, base } = await ctx(fd);
  await deleteOffer(scope, String(fd.get("id")));
  revalidatePath(base, "layout");
}
