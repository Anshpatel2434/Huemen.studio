/**
 * The claims a rewrite left out because the brand facts do not back them.
 *
 * The check already flags each one ("unsupported_claim", with the sentence as
 * its excerpt) and the rewrite is told to fix them, so it drops or softens
 * them. The person used to get the new text with no word of what went: this
 * lists the flagged claims of the draft that are no longer in the rewrite.
 * Pure, client-safe; uses only what the check returned.
 */
type Issue = { code: string; excerpt?: string };

const norm = (s: string) => s.replace(/…$/, "").replace(/\s+/g, " ").trim().toLowerCase();

export function refusedClaims(issues: readonly Issue[], before: string, after: string): string[] {
  const was = norm(before);
  const now = norm(after);
  const out: string[] = [];
  for (const i of issues) {
    if (i.code !== "unsupported_claim" || !i.excerpt) continue;
    const e = norm(i.excerpt);
    // Only claims still in the draft that was rewritten, and gone from the rewrite.
    if (!e || !was.includes(e) || now.includes(e)) continue;
    if (!out.some((o) => norm(o) === e)) out.push(i.excerpt.trim());
  }
  return out;
}
