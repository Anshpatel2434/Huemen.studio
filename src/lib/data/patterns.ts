/**
 * "What we noticed": patterns across a person's sources, and what they decide.
 *
 *   Said everywhere   kept: becomes a signature phrase drafts may use (and it
 *                     survives a re-scan); not me: never shown again.
 *   Never posted      make it an idea: lands in the idea inbox, tagged to a
 *                     pillar; not me: never shown again.
 *
 * Topics from private writing are found fresh for the owner and never stored
 * in the clear (see Onboarding.patterns).
 *
 * Server-only.
 */
import "server-only";
import { createHash } from "node:crypto";
import { findPatterns, patternsBasis, type Patterns } from "@/lib/voice/patterns";
import type { VoicePack, VoiceSample } from "@/lib/voice/types";
import { captureIdea } from "./planning";
import { updateOnboarding } from "./onboarding";
import { writePack, type Actor } from "./training";
import type { WorkspaceScope } from "./projects";

const hash = (term: string) => `h:${createHash("sha256").update(term.toLowerCase()).digest("base64url").slice(0, 16)}`;

/**
 * The patterns to show. `includePrivate` is for the person themselves: a coach
 * sees only what was said publicly.
 */
export async function patternsFor(
  scope: WorkspaceScope,
  pack: VoicePack,
  samples: VoiceSample[],
  opts: { includePrivate: boolean },
): Promise<Patterns> {
  const p = pack.onboarding.patterns ?? {};
  const basis = patternsBasis(pack.corpusStats);
  const skip = [...(p.kept ?? []), ...(p.dismissed ?? [])];
  const cached = p.found?.basis === basis ? p.found.everywhere : null;

  let found: Patterns | null = null;
  if (opts.includePrivate || !cached) {
    found = findPatterns(
      samples.filter((s) => !s.excluded && s.kind !== "anti_sample").map((s) => ({ body: s.body, channel: s.channel, visibility: s.visibility })),
    );
    if (!cached) await updateOnboarding(scope, pack, { patterns: { ...p, found: { basis, everywhere: found.everywhere } } });
  }
  const decided = new Set(p.privateDecided ?? []);
  const skipSet = new Set(skip);
  return {
    everywhere: (found?.everywhere ?? cached ?? []).filter((e) => !skipSet.has(e.phrase)),
    privateOnly: opts.includePrivate ? (found?.privateOnly ?? []).filter((t) => !decided.has(hash(t.term))) : [],
  };
}

export async function decidePattern(
  scope: WorkspaceScope,
  actor: Actor,
  pack: VoicePack,
  d: { kind: "everywhere" | "private"; value: string; keep: boolean },
): Promise<void> {
  const value = d.value.trim().toLowerCase().slice(0, 120);
  if (!value) return;
  const p = pack.onboarding.patterns ?? {};
  const add = (xs: string[] | undefined, x: string) => [...new Set([...(xs ?? []), x])];

  if (d.kind === "everywhere") {
    if (d.keep) {
      await writePack(
        scope, actor, pack,
        { index: { ...pack.index, signaturePhrases: add(pack.index.signaturePhrases, value) } },
        `Kept "${value}" as a signature phrase.`,
      );
    }
    await updateOnboarding(scope, pack, { patterns: { ...p, [d.keep ? "kept" : "dismissed"]: add(d.keep ? p.kept : p.dismissed, value) } });
    return;
  }

  if (d.keep) await captureIdea(scope, `Write about ${value}: you explain it often in email but haven't posted about it yet.`);
  await updateOnboarding(scope, pack, { patterns: { ...p, privateDecided: add(p.privateDecided, hash(value)) } });
}
