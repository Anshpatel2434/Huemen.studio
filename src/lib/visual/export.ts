/**
 * Names and sizes for exported visuals. Pure and client-safe.
 *
 * A file is named after the brand AND the piece, so two pieces never save
 * over each other: `alex-rivera-copying-kills-uniqueness-post-1080x1350.png`.
 * Two pieces whose hooks read the same get a short id each.
 */

/** A filename-safe slug: "The Brand Professor" → "the-brand-professor". */
export const fileSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "visual";

const pieceSlug = (hook: string) => fileSlug(hook).slice(0, 32).replace(/-+$/, "") || "visual";

/** The start of every file name for one piece's visuals. */
export function exportBase(brand: string, piece: { id: string; hook: string }, all: { id: string; hook: string }[]): string {
  const slug = pieceSlug(piece.hook);
  const clash = all.some((o) => o.id !== piece.id && pieceSlug(o.hook) === slug);
  return `${fileSlug(brand)}-${slug}${clash ? `-${piece.id.replace(/[^0-9a-z]/gi, "").slice(0, 6).toLowerCase()}` : ""}`;
}

/** Each export size once, with every format that uses it. */
export function exportSizes(formats: { label: string; frame: { w: number; h: number } }[]): { size: string; formats: string[] }[] {
  const out = new Map<string, { size: string; formats: string[] }>();
  for (const f of formats) {
    const key = `${f.frame.w}x${f.frame.h}`;
    const row = out.get(key) ?? { size: `${f.frame.w}×${f.frame.h}`, formats: [] };
    if (!row.formats.includes(f.label)) row.formats.push(f.label);
    out.set(key, row);
  }
  return [...out.values()];
}
