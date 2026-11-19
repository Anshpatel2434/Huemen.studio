/**
 * Small pure rules of the Visual board, kept out of the component so they can
 * be tested:
 *
 *   draftsKey, restoreDrafts
 *              changes pinned and not sent yet are kept in the browser for the
 *              project, and put back when the board opens (PI-07). What comes
 *              back is checked: only drafts on visuals that are still on the
 *              board, in the shape the board makes, at most MAX_PINS_PER_SEND
 *              per piece.
 *   toolsOff   which picture tools can be used at all, from every picture on
 *              the board (PI-02, PI-36), and why not when none can.
 *
 * Client-safe: no I/O.
 */
import type { ArtboardKind, PictureMode } from "@/lib/visual/design";
import { MAX_PINS_PER_SEND, PIN_KINDS, type PinKind } from "@/lib/visual/picture-tools";
import type { DraftPin } from "./visual-comments-ui";

/** Where a project's unsent changes are kept in this browser. */
export const draftsKey = (tenantId: string, projectId: string) => `hu:visual-drafts:${tenantId}:${projectId}`;

const ARTBOARDS: readonly ArtboardKind[] = ["post", "quote", "carousel"];
const TARGETS = ["picture", "headline", "body", "cta", "logo", "background"] as const;
const isBox = (b: unknown): b is { x: number; y: number; w: number; h: number } =>
  !!b && typeof b === "object" && ["x", "y", "w", "h"].every((k) => Number.isFinite((b as Record<string, unknown>)[k]));

/**
 * The saved drafts that still fit this board: on a piece and a visual that are
 * here (the visual's id unchanged), of a known kind and part, with a box. A
 * reason from a failed Send is dropped (it is said again if it fails again).
 */
export function restoreDrafts(saved: unknown, items: { id: string; visuals: Partial<Record<ArtboardKind, string>> }[]): DraftPin[] {
  if (!Array.isArray(saved)) return [];
  const perItem = new Map<string, number>();
  const out: DraftPin[] = [];
  for (const raw of saved as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") continue;
    const item = items.find((i) => i.id === raw.itemId);
    const artboard = raw.artboard as ArtboardKind;
    if (!item || !ARTBOARDS.includes(artboard) || item.visuals[artboard] !== raw.visualId) continue;
    if (!PIN_KINDS.includes(raw.kind as PinKind) || !TARGETS.includes(raw.target as (typeof TARGETS)[number])) continue;
    if (typeof raw.id !== "string" || typeof raw.note !== "string" || !isBox(raw.box)) continue;
    const n = perItem.get(item.id) ?? 0;
    if (n >= MAX_PINS_PER_SEND) continue;
    perItem.set(item.id, n + 1);
    const { error: _error, ...rest } = raw as DraftPin & { error?: string };
    void _error;
    out.push({
      ...rest,
      frame: Number.isInteger(raw.frame) ? (raw.frame as number) : 0,
      offered: Array.isArray(raw.offered) ? (raw.offered as DraftPin["offered"]) : [raw.target as DraftPin["target"]],
      area: isBox(raw.area) ? raw.area : null,
    } as DraftPin);
  }
  return out;
}

export const NO_PICTURE = "Add a picture first";
export const ALL_CUTOUT = "Every picture here has its background removed. Go back to the version before to change one.";
export const ALL_DRAWN_IN = "Every picture here has its heading drawn in. Switch one to live text first.";

/**
 * Why each picture tool can't be used on this board, when it can't: no
 * picture anywhere; every picture a cut-out (nothing can change one); for
 * Resize and Remove background, every picture that isn't a cut-out has its
 * heading drawn in. A tool any picture can take is on (undefined).
 */
export function toolsOff(pictures: { cutout: boolean; mode: PictureMode }[]): Record<"markup" | "erase" | "cutout" | "resize", string | undefined> {
  if (!pictures.length) return { markup: NO_PICTURE, erase: NO_PICTURE, cutout: NO_PICTURE, resize: NO_PICTURE };
  const editable = pictures.filter((p) => !p.cutout);
  const reshapable = editable.filter((p) => p.mode !== "with_text");
  const draw = editable.length ? undefined : ALL_CUTOUT;
  const shape = reshapable.length ? undefined : editable.length ? ALL_DRAWN_IN : ALL_CUTOUT;
  return { markup: draw, erase: draw, cutout: shape, resize: shape };
}
