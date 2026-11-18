/**
 * How a version in a piece's history is named, and which one is on the piece
 * now. Pure: shared by the edit panel and its tests.
 *
 * A row says where it came from in two columns (lib/data/content):
 *   model  the model that wrote it; null for words the person typed;
 *          "own-writing" / "co-write-outline" for a piece that started that way
 *   steer  null for a first draft; the ask for a steer; "Rewrite: ..." for a
 *          rewrite in their voice, of one part, or a line fix
 */

export interface VersionRow {
  id: string;
  variantIndex: number;
  steer: string | null;
  model: string | null;
  hook: string;
  body: string;
  cta: string;
}

const REWRITE = "Rewrite: ";

/** A first draft: written by a model, with no ask behind it. */
const isDraft = (v: Pick<VersionRow, "model" | "steer">) =>
  !!v.model && !v.steer && v.model !== "own-writing" && v.model !== "co-write-outline";

/** "Draft", "Draft 2", "Rewrite: Shorter", "Edited by you", "Your own writing", "Outline". */
export function versionLabel(v: Pick<VersionRow, "model" | "steer" | "variantIndex">, all: Pick<VersionRow, "model" | "steer">[] = []): string {
  if (v.model === "own-writing") return "Your own writing";
  if (v.model === "co-write-outline") return "Outline";
  if (!v.model) return "Edited by you";
  if (v.steer) return v.steer.startsWith(REWRITE) ? v.steer : `${REWRITE}${v.steer}`;
  return all.filter(isDraft).length > 1 ? `Draft ${v.variantIndex + 1}` : "Draft";
}

/** Whether a person typed this version (the pencil in the list). */
export const typedByPerson = (v: Pick<VersionRow, "model">): boolean => !v.model || v.model === "own-writing";

/**
 * The version that is on the piece now: the newest row with the same words.
 * Null when the piece has been edited since its last recorded version.
 */
export function currentVersionId(piece: { hook: string; body: string; cta: string }, history: VersionRow[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const v = history[i];
    if (v.hook === piece.hook && v.body === piece.body && v.cta === piece.cta) return v.id;
  }
  return null;
}
