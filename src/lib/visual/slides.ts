/**
 * A piece's copy as carousel frames. Pure and client-safe.
 *
 * The first frame is the hook, the last the call to action (when there is
 * one), and the body fills the frames between: one line (paragraph or list
 * item) per frame while they fit, and neighbouring lines grouped evenly when
 * there are more lines than frames. Nothing is dropped: the end of a long body
 * used to stop at the fifth line and jump to the call to action (2026-11-17).
 *
 * Each frame remembers where its text sits in the body (the parts of
 * `body.split(/(\n+)/)`, separators included), so an edit on a frame writes
 * back to exactly those lines and the spacing around them is kept.
 */
export const MAX_BODY_FRAMES = 5;

export type SlideSrc = { kind: "hook" } | { kind: "body"; from: number; to: number } | { kind: "cta" };
export type Slide = { text: string; src: SlideSrc };
type Copy = { hook: string; body: string; cta: string };

export function slidesOf(i: Copy, maxBody = MAX_BODY_FRAMES): Slide[] {
  const parts = i.body.split(/(\n+)/);
  const lines = parts.map((t, part) => ({ t: t.trim(), part })).filter((x) => x.part % 2 === 0 && x.t).map((x) => x.part);
  const frames = Math.min(lines.length, Math.max(1, maxBody));
  const body: Slide[] = [];
  for (let g = 0; g < frames; g++) {
    const from = lines[Math.floor((g * lines.length) / frames)];
    const to = lines[Math.floor(((g + 1) * lines.length) / frames) - 1];
    body.push({ text: parts.slice(from, to + 1).join("").trim(), src: { kind: "body", from, to } });
  }
  return [
    { text: i.hook, src: { kind: "hook" } },
    ...body,
    ...(i.cta ? [{ text: i.cta, src: { kind: "cta" } } as Slide] : []),
  ];
}

/** The post field a frame edit changes. An emptied body frame drops its lines. */
export function patchForSlide(i: Copy, slide: Slide, text: string): { hook?: string; body?: string; cta?: string } {
  if (slide.src.kind === "hook") return { hook: text };
  if (slide.src.kind === "cta") return { cta: text };
  const { from, to } = slide.src;
  const parts = i.body.split(/(\n+)/);
  if (text) parts.splice(from, to - from + 1, text);
  else parts.splice(from, to - from + 1 + (to + 1 < parts.length ? 1 : 0));
  return { body: parts.join("").replace(/^\n+|\n+$/g, "") };
}
