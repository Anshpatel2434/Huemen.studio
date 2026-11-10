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
  addCalendarEntry, archiveIdea, captureIdea, createOffer, deleteCalendarEntry, deleteOffer, updateOffer,
  generateCalendar, getCalendarEntry, getIdea, markIdeaStarted, markSlotStarted, setIdeaPillar,
} from "@/lib/data/planning";
import { FORMATS } from "@/lib/content/formats";
import { startPiece } from "@/lib/data/create";
import { CALENDAR_CHANNELS } from "@/lib/content/calendar-plan";

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

/**
 * A planned calendar slot becomes a new piece with everything the plan said:
 * topic, platform, pillar, and the hook angle and call to action as the
 * piece's angle (which the writing step reads). The slot then points at the
 * piece, so it shows "Open" rather than starting another one.
 */
export async function startFromSlotAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  const slot = await getCalendarEntry(scope, String(fd.get("id") ?? ""));
  if (!slot) return refresh(t);
  if (slot.startedProjectId) redirect(`/w/${t}/p/${slot.startedProjectId}/ideate`);
  const angle = [slot.hookAngle?.trim(), slot.cta?.trim() && `Close with: ${slot.cta.trim()}`].filter(Boolean).join(". ");
  const projectId = await startPiece(scope, {
    topic: slot.topic?.trim() || "Planned piece",
    format: slot.channel ? FORMATS.find((f) => f.channel === slot.channel)?.key ?? null : null,
    pillarId: slot.pillarId,
    angle: angle || null,
  });
  await markSlotStarted(scope, slot.id, projectId);
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

/** The 90-day plan. Returns what was planned and how many days were already taken. */
export async function generateCalendarAction(
  tenantId: string,
  opts: { start: string; perWeek: number; channels: string[] },
): Promise<{ planned: number; skipped: number }> {
  const scope = await actionScope(tenantId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.start)) throw new Error("bad start date");
  const channels = opts.channels.filter((c) => CALENDAR_CHANNELS.some((k) => k.key === c));
  const out = await generateCalendar(scope, { start: opts.start, perWeek: opts.perWeek, channels });
  refresh(tenantId);
  return out;
}

export async function deleteCalendarEntryAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  await deleteCalendarEntry(scope, String(fd.get("id")));
  refresh(t);
}

const offerFrom = (fd: FormData, name: string) => ({
  name,
  format: String(fd.get("format") ?? ""),
  promise: String(fd.get("promise") ?? ""),
  deliverables: String(fd.get("deliverables") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
  pricingLogic: String(fd.get("pricingLogic") ?? ""),
});

export async function createOfferAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  await createOffer(scope, offerFrom(fd, name));
  refresh(t);
}

export async function updateOfferAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  const name = String(fd.get("name") ?? "").trim();
  if (name) await updateOffer(scope, String(fd.get("id")), offerFrom(fd, name));
  refresh(t);
  redirect(`/w/${t}/plan/offers`);
}

export async function deleteOfferAction(fd: FormData) {
  const { t, scope } = await ctx(fd);
  await deleteOffer(scope, String(fd.get("id")));
  refresh(t);
}
