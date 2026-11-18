/**
 * What a comment on a visual's text says when its rewrite is refused because
 * it would add claims the brand facts don't back (lib/voice/judge
 * UnsupportedRewriteError). The claims the checker found are listed, short,
 * one per line, so the person sees exactly what was refused. Pure.
 */
import type { UnsupportedClaim } from "@/lib/voice/facts";

/** How many claims are listed; the rest are counted. */
const SHOWN = 3;
/** Longest excerpt shown, in characters. */
const CLIP = 90;

const clip = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > CLIP ? `${t.slice(0, CLIP - 1).trimEnd()}…` : t;
};

export function refusedClaimsNote(claims: UnsupportedClaim[]): string {
  const seen = [...new Set(claims.map((c) => clip(c.excerpt)).filter(Boolean))];
  if (!seen.length) return "Not changed: the rewrite would add claims that aren't in your brand facts. Ask again without new facts.";
  const lines = seen.slice(0, SHOWN).map((e) => `“${e}”`);
  if (seen.length > SHOWN) lines.push(`and ${seen.length - SHOWN} more`);
  return [
    `Not changed. The rewrite would add ${seen.length === 1 ? "a claim that isn't" : "claims that aren't"} in your brand facts:`,
    ...lines,
    "If it's true, add it to your facts in Brand core; otherwise ask again without it.",
  ].join("\n");
}
