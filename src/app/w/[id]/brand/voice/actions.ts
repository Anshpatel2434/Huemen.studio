"use server";

import { revalidatePath } from "next/cache";
import { actionScope } from "@/lib/auth/workspace";
import {
  addSamples, deleteSample, loadPackForWorkspace, rescan, savePack, setSampleExcluded,
} from "@/lib/data/voice-pack";
import { tagged } from "@/lib/voice/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

async function packFor(fd: FormData) {
  const tenantId = str(fd, "tenantId");
  const scope = await actionScope(tenantId);
  const pack = await loadPackForWorkspace(scope);
  return { scope, pack, path: `/w/${tenantId}/brand/voice` };
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
    await rescan(scope, pack.id);
  }
  revalidatePath(path);
}

/** Re-measure everything on file. Proposes; never overwrites what was typed. */
export async function rescanAction(fd: FormData): Promise<void> {
  const { scope, pack, path } = await packFor(fd);
  if (pack) await rescan(scope, pack.id);
  revalidatePath(path);
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
  const { scope, pack, path } = await packFor(fd);
  if (!pack) return;
  const never = csv(str(fd, "neverWords"));
  const rules = str(fd, "hardRules").split("\n").map((l) => l.trim()).filter(Boolean);

  await savePack(
    scope,
    pack.id,
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
  revalidatePath(path);
}

/**
 * Keep a habit the scan found, or drop it. "Keep" records a proven exception,
 * which is what lets one person's ellipsis survive the universal anti-AI list
 * while another person's ban on it also survives.
 */
export async function resolveSignatureAction(fd: FormData): Promise<void> {
  const { scope, pack, path } = await packFor(fd);
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
  await savePack(scope, pack.id, { index }, keep ? `Kept "${phrase}".` : `Dropped "${phrase}".`);
  revalidatePath(path);
}
