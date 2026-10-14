/**
 * "What we noticed": phrases a person uses across their sources, and what
 * they decide about them.
 *
 *   Keep it   becomes a signature phrase drafts may use (and it survives a re-scan)
 *   Not me    never shown again
 *
 * Only phrases they have also said publicly are ever shown (lib/voice/patterns),
 * so the result is safe to cache on the pack, which a coach can see.
 *
 * Server-only.
 */
import "server-only";
import { findPatterns, patternsBasis, type Patterns } from "@/lib/voice/patterns";
import type { VoicePack, VoiceSample } from "@/lib/voice/types";
import { updateOnboarding } from "./onboarding";
import { writePack, type Actor } from "./training";
import type { WorkspaceScope } from "./projects";

export async function patternsFor(scope: WorkspaceScope, pack: VoicePack, samples: VoiceSample[]): Promise<Patterns> {
  const p = pack.onboarding.patterns ?? {};
  const basis = patternsBasis(pack.corpusStats);
  let everywhere = p.found?.basis === basis ? p.found.everywhere : null;
  if (!everywhere) {
    everywhere = findPatterns(
      samples.filter((s) => !s.excluded && s.kind !== "anti_sample").map((s) => ({ body: s.body, channel: s.channel, visibility: s.visibility })),
    ).everywhere;
    await updateOnboarding(scope, pack, { patterns: { ...p, found: { basis, everywhere } } });
  }
  const skip = new Set([...(p.kept ?? []), ...(p.dismissed ?? [])]);
  return { everywhere: everywhere.filter((e) => !skip.has(e.phrase)) };
}

export async function decidePattern(
  scope: WorkspaceScope,
  actor: Actor,
  pack: VoicePack,
  d: { value: string; keep: boolean },
): Promise<void> {
  const value = d.value.trim().toLowerCase().slice(0, 120);
  if (!value) return;
  const p = pack.onboarding.patterns ?? {};
  const add = (xs: string[] | undefined, x: string) => [...new Set([...(xs ?? []), x])];
  if (d.keep) {
    await writePack(
      scope, actor, pack,
      { index: { ...pack.index, signaturePhrases: add(pack.index.signaturePhrases, value) } },
      `Kept "${value}" as a signature phrase.`,
    );
  }
  await updateOnboarding(scope, pack, { patterns: { ...p, [d.keep ? "kept" : "dismissed"]: add(d.keep ? p.kept : p.dismissed, value) } });
}
