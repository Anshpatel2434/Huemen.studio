"use server";

/**
 * Planning: the idea inbox, the calendar and offers. Workspace-level since
 * build step 3. Turning an idea or a calendar slot into writing starts a NEW
 * piece (one output per project), at Ideate.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionScope } from "@/lib/auth/workspace";
import {
  addCalendarEntry, archiveIdea, captureIdea, createOffer, deleteCalendarEntry, deleteOffer,
  getIdea, markIdeaStarted, setIdeaPillar,
} from "@/lib/data/planning";
import { startPiece } from "@/lib/data/create";

async function ctx(fd: FormData) {
  const t = String(fd.get("tenantId"));
  return { t, scope: await actionScope(t) };
}
const refresh = (t: string) => revalidatePath(`/w/${t}`, "layout");

export async function captureIdeaAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  const text = String(fd.get("text") ?? "").trim();
  if (text) await captureIdea(scope, text);
  refresh(t);
}

export async function setIdeaPillarAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  await setIdeaPillar(scope, String(fd.get("id")), String(fd.get("pillarId") ?? "") || null);
  refresh(t);
}

export async function archiveIdeaAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  await archiveIdea(scope, String(fd.get("id")));
  refresh(t);
}

/** An idea becomes a new piece, at Ideate, with the idea linked to it. */
export async function convertIdeaAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  const idea = await getIdea(scope, String(fd.get("id")));
  if (!idea) return;
  const projectId = await startPiece(scope, {
    topic: idea.raw_text,
    format: String(fd.get("format") ?? "") || null,
    ideaId: idea.id,
  });
  await markIdeaStarted(scope, idea.id);
  refresh(t);
  redirect(`/w/${t}/p/${projectId}/ideate`);
}

/** A planned calendar slot becomes a new piece with its topic filled in. */
export async function startFromSlotAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  const topic = String(fd.get("topic") ?? "").trim() || "Planned piece";
  const projectId = await startPiece(scope, { topic });
  refresh(t);
  redirect(`/w/${t}/p/${projectId}/ideate`);
}

export async function addCalendarEntryAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
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
  refresh(t);
}

export async function deleteCalendarEntryAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  await deleteCalendarEntry(scope, String(fd.get("id")));
  refresh(t);
}

export async function createOfferAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  await createOffer(scope, {
    name,
    format: String(fd.get("format") ?? ""),
    promise: String(fd.get("promise") ?? ""),
    deliverables: String(fd.get("deliverables") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    pricingLogic: String(fd.get("pricingLogic") ?? ""),
  });
  refresh(t);
}

export async function deleteOfferAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  await deleteOffer(scope, String(fd.get("id")));
  refresh(t);
}
