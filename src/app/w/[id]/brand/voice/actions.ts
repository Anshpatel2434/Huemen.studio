"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionActor } from "@/lib/auth/workspace";
import {
  addSamples, deleteSample, loadPackForWorkspace, rescan, setSampleExcluded,
} from "@/lib/data/voice-pack";
import { decideEditProposal, decideProposal, restoreVersion, writePack, type WriteOutcome } from "@/lib/data/training";
import { tagged } from "@/lib/voice/types";
import { finishIngest } from "@/lib/data/onboarding";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Who is acting matters here: the owner's change saves, a coach's becomes a
 * proposal the owner approves (lib/data/training `writePack`).
 */
async function packFor(fd: FormData) {
  const tenantId = str(fd, "tenantId");
  const { scope, actor } = await actionActor(tenantId);
  const pack = await loadPackForWorkspace(scope);
  return { scope, actor, pack, path: `/w/${tenantId}/brand/voice` };
}

/** Back to the page, saying whether the change saved or waits for approval. */
function done(path: string, outcome: WriteOutcome | null): never {
  revalidatePath(path);
  redirect(outcome && "proposed" in outcome ? `${path}?proposed=1` : path);
}

/**
 * Add writing to the corpus. Pieces are separated by a blank line, because a
 * real post has line breaks inside it and one-per-line would shred it.
 */
export async function addSamplesAction(fd: FormData): Promise<void> {
  const { scope, pack, path } = await packFor(fd);
  if (!pack) return;
  const channel = str(fd, "channel") || "unknown";
  const visibility = str(fd, "visibility") === "private" ? "private" : "public";
  const bodies = str(fd, "text").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (bodies.length) {
    await addSamples(scope, pack.id, bodies.map((body) => ({ body, channel, visibility, source: "paste" as const })));
    await finishIngest(scope, pack);
  }
  revalidatePath(path);
}

/** Re-measure everything on file. Proposes; never overwrites what was typed. */
export async function rescanAction(fd: FormData): Promise<void> {
  const { scope, pack, path } = await packFor(fd);
  // Through finishIngest, so "Building your core" is stored and survives a refresh.
  const changes = pack ? (await finishIngest(scope, pack)).changes : [];
  revalidatePath(path);
  // What moved, in plain English (file 06 §6), carried on the URL for one view.
  const q = new URLSearchParams({ scanned: "1" });
  for (const c of changes.slice(0, 6)) q.append("moved", c);
  redirect(`${path}?${q}`);
}

export async function excludeSampleAction(fd: FormData): Promise<void> {
  const { scope, path } = await packFor(fd);
  await setSampleExcluded(scope, str(fd, "sampleId"), str(fd, "excluded") === "1", "Not mine");
  const pack = (await loadPackForWorkspace(scope))!;
  await rescan(scope, pack.id);
  revalidatePath(path);
}

export async function deleteSampleAction(fd: FormData): Promise<void> {
  const { scope, pack, path } = await packFor(fd);
  await deleteSample(scope, str(fd, "sampleId"));
  if (pack) await rescan(scope, pack.id);
  revalidatePath(path);
}

/** The parts of the pack a person edits by hand. */
export async function saveVoiceAction(fd: FormData): Promise<void> {
  const { scope, actor, pack, path } = await packFor(fd);
  if (!pack) return;
  const never = csv(str(fd, "neverWords"));
  const rules = str(fd, "hardRules").split("\n").map((l) => l.trim()).filter(Boolean);

  const outcome = await writePack(
    scope,
    actor,
    pack,
    {
      voiceLine: str(fd, "voiceLine"),
      hardRules: rules,
      identity: {
        ...pack.identity,
        reader: tagged(str(fd, "reader"), "ask"),
        carries: tagged(str(fd, "carries"), "ask"),
      },
      redPen: { ...pack.redPen, neverList: tagged(never, "ask") },
      index: { ...pack.index, neverWords: never },
    },
    "Edited by hand.",
  );
  done(path, outcome);
}

/**
 * Keep a habit the scan found, or drop it. "Keep" records a proven exception,
 * which is what lets one person's ellipsis survive the universal anti-AI list
 * while another person's ban on it also survives.
 */
export async function resolveSignatureAction(fd: FormData): Promise<void> {
  const { scope, actor, pack, path } = await packFor(fd);
  if (!pack) return;
  const phrase = str(fd, "phrase");
  const keep = str(fd, "keep") === "1";
  const index = { ...pack.index };
  if (keep) {
    index.allowedExceptions = [...new Set([...index.allowedExceptions, phrase])];
  } else {
    index.neverWords = [...new Set([...index.neverWords, phrase])];
    index.signaturePhrases = index.signaturePhrases.filter((p) => p !== phrase);
  }
  done(path, await writePack(scope, actor, pack, { index }, keep ? `Kept "${phrase}".` : `Dropped "${phrase}".`));
}

// ---- training: proposals, learned rules, history ------------------------------

/** The owner approves or rejects a coach's proposed change. */
export async function decideProposalAction(fd: FormData): Promise<void> {
  const { scope, actor, pack, path } = await packFor(fd);
  if (pack) await decideProposal(scope, actor, pack, str(fd, "proposalId"), str(fd, "approve") === "1");
  revalidatePath(path);
}

/** A word they kept cutting from drafts: add it to the never-list, or not. */
export async function decideEditAction(fd: FormData): Promise<void> {
  const { scope, actor, pack, path } = await packFor(fd);
  if (pack) await decideEditProposal(scope, actor, pack, str(fd, "signalId"), str(fd, "accept") === "1");
  revalidatePath(path);
}

export async function restoreVersionAction(fd: FormData): Promise<void> {
  const { scope, actor, pack, path } = await packFor(fd);
  if (!pack) return;
  done(path, await restoreVersion(scope, actor, pack, Number(str(fd, "version"))));
}

/** Re-measure, step one: show what would change, change nothing (plan, Flow 4). */
export async function previewRescanAction(fd: FormData): Promise<void> {
  const { path } = await packFor(fd);
  redirect(`${path}?preview=1#remeasure`);
}
