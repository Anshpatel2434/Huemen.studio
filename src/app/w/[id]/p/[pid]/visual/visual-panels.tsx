"use client";

/**
 * Pieces of the visual board that are not the canvas itself:
 *
 *   PictureVersions   every version of a visual's picture (fresh draws, area
 *                     and markup changes, erases, resizes, cut-outs), newest
 *                     first, each named by how it came to be, the one in use
 *                     marked; click one to use it. Lives in the Details panel.
 *   RangeSlider       the same slider as Type size, for any range (Resize's zoom).
 *   HeadingCheck      a quiet note under a visual whose picture has the
 *                     heading drawn into it: either the piece's heading has
 *                     changed since (stale), or the spelling is for the person to check.
 *   ExportSizes       each export size once, with every format that uses it.
 *   useFontRenders    whether the brand's font is really rendering here.
 *   BrandFonts        loads the brand fonts (uploaded files, else Google).
 *   ScaleSlider       the Type size control (role="slider", no native range).
 *   BoardIconButton   an icon button named by aria-label, no native tooltip.
 *   useFitStates      how each piece's text fitted its frames (the layouts'
 *                     <Fit> writes data-fit), for the look check.
 *
 * Huemen components only: no browser dialogs, selects or prompts.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { btnClass, iconBtnClass } from "@/components/btn";
import { FORMATS } from "@/lib/content/formats";
import { SCALE, scaleAt, scaleForKey, type ArtboardKind, type PictureMode } from "@/lib/visual/design";
import { exportSizes } from "@/lib/visual/export";
import { fontFaceCss, googleFontsHref, type FontPlan } from "@/lib/visual/fonts";
import { PICTURE_OP_LABEL, type PictureOp } from "@/lib/visual/picture-tools";
import { WORDS_NOTICE } from "@/lib/visual/picture-words";
import { rangeAt, rangeForKey, type Range } from "./picture-tools-maths";

/**
 * The brand fonts for this page (lib/visual/fonts): @font-face rules for the
 * uploaded files (signed same-origin links) and Google's stylesheet for the
 * rest. Plain CSS in the document, so the PNG export embeds the same faces.
 * The Google sheet is fetched with CORS, so the export can read its rules.
 */
export function BrandFonts({ plan }: { plan: FontPlan }) {
  const css = fontFaceCss(plan.faces);
  const href = googleFontsHref(plan.google);
  return (
    <>
      {css && <style data-brand-fonts="" dangerouslySetInnerHTML={{ __html: css }} />}
      {href && <link rel="stylesheet" href={href} crossOrigin="anonymous" />}
    </>
  );
}

/**
 * An icon-only button on the board: named for screen readers by aria-label,
 * with no `title` (a native browser tooltip is system UI). `expanded` is for a
 * button that opens a menu.
 */
export function BoardIconButton({ label, onClick, disabled, expanded, className = "", children }: {
  label: string; onClick?: () => void; disabled?: boolean; expanded?: boolean; className?: string; children?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-expanded={expanded} className={iconBtnClass(className)}>
      {children}
    </button>
  );
}

/**
 * Type size, a Huemen slider (no native range input): drag or click the track,
 * or use the arrow keys (5%), Page Up/Down (10%), Home and End. `value` is a
 * percentage from SCALE.min to SCALE.max in SCALE.step steps.
 */
export function ScaleSlider({ value, onChange, label = "Type size" }: { value: number; onChange: (pct: number) => void; label?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    return r && r.width ? scaleAt((clientX - r.left) / r.width) : value;
  };
  const set = (n: number) => { if (n !== value) onChange(n); };
  const pct = ((value - SCALE.min) / (SCALE.max - SCALE.min)) * 100;
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={SCALE.min}
      aria-valuemax={SCALE.max}
      aria-valuenow={value}
      aria-valuetext={`${value}%`}
      aria-orientation="horizontal"
      onKeyDown={(e) => {
        const n = scaleForKey(value, e.key);
        if (n === null) return;
        e.preventDefault();
        e.stopPropagation();
        set(n);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        set(at(e.clientX));
      }}
      onPointerMove={(e) => { if (dragging.current) set(at(e.clientX)); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      className="relative min-h-11 px-2 flex items-center cursor-pointer touch-none select-none outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-ink"
    >
      <div ref={track} className="relative w-full h-1 rounded-full bg-field">
        <div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${pct}%` }} />
        <div aria-hidden="true" className="absolute top-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper border-2 border-ink" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * A slider for any range, the same Huemen control as Type size (no native
 * range input): drag or click the track, arrow keys one step, Page Up/Down
 * two, Home and End. `snap` lets a caller add a stop of its own (Resize snaps
 * to the zoom at which the picture just fills the frame).
 */
export function RangeSlider({ value, range, onChange, label, valueText, snap }: {
  value: number; range: Range; onChange: (v: number) => void; label: string; valueText: string;
  snap?: (v: number) => number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const land = (v: number) => (snap ? snap(v) : v);
  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    return r && r.width ? land(rangeAt((clientX - r.left) / r.width, range)) : value;
  };
  const set = (n: number) => { if (n !== value) onChange(n); };
  const pct = Math.min(100, Math.max(0, ((value - range.min) / (range.max - range.min)) * 100));
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
      aria-orientation="horizontal"
      onKeyDown={(e) => {
        const n = rangeForKey(value, e.key, range);
        if (n === null) return;
        e.preventDefault();
        e.stopPropagation();
        set(land(n));
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        set(at(e.clientX));
      }}
      onPointerMove={(e) => { if (dragging.current) set(at(e.clientX)); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      className="relative min-h-11 px-2 flex items-center cursor-pointer touch-none select-none outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-ink"
    >
      <div ref={track} className="relative w-full h-1 rounded-full bg-field">
        <div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${pct}%` }} />
        <div aria-hidden="true" className="absolute top-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper border-2 border-ink" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * One version of a visual's picture, as the page loads it (lib/data/pictures
 * PictureVersion). `op` is how it came to be, `cutout` that its background is
 * removed (a PNG with alpha), `width` and `height` its own pixels.
 */
export type Version = {
  id: string; contentItemId: string; artboard: ArtboardKind; mode: PictureMode;
  heading: string | null; parentId: string | null; createdAt: string; url: string;
  op?: PictureOp; width?: number; height?: number; cutout?: boolean;
  /** It should have no words and may still show some (lib/data/pictures keepWordsOut). */
  textLeft?: boolean;
};

/** How a version came to be, in the strip's words. Versions from before the picture tools carry no `op`. */
export function versionLabel(v: Pick<Version, "op" | "parentId" | "mode">): string {
  if (v.op && v.op !== "draw" && PICTURE_OP_LABEL[v.op]) return PICTURE_OP_LABEL[v.op];
  if (!v.op && v.parentId) return "area change";
  return v.mode === "with_text" ? "new, heading drawn in" : PICTURE_OP_LABEL.draw;
}

const KINDS: { key: ArtboardKind; label: string }[] = [
  { key: "post", label: "Post image" }, { key: "quote", label: "Quote card" }, { key: "carousel", label: "Carousel cover" },
];
/** How many versions of one visual's picture are listed. */
const MAX_SHOWN = 12;

/** Whether two headings read the same (spacing aside). */
export const sameHeading = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** `id` and every version it was made from, back to the fresh draw. */
export function lineage(id: string | null | undefined, versions: Version[]): Set<string> {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const out = new Set<string>();
  for (let cur = id ?? null; cur && !out.has(cur); cur = byId.get(cur)?.parentId ?? null) out.add(cur);
  return out;
}

export function PictureVersions({ versions, inUse, busy, onUse }: {
  /** This piece's versions, newest first. */
  versions: Version[];
  /** The picture each visual shows now. */
  inUse: Partial<Record<ArtboardKind, string>>;
  /** A version is being switched to. */
  busy: boolean;
  onUse: (kind: ArtboardKind, id: string) => void;
}) {
  if (!versions.length) {
    return <p className="text-sm text-ink-muted">No pictures on this piece yet. Add one from the picture button above a visual; every picture you draw or change is kept here.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {KINDS.map(({ key, label }) => {
        const all = versions.filter((v) => v.artboard === key);
        if (!all.length) return null;
        return (
          <div key={key}>
            <p className="text-xs font-medium mb-1.5">{label} <span className="text-ink-faint font-normal">· {all.length} version{all.length === 1 ? "" : "s"}{inUse[key] ? "" : " · none in use"}</span></p>
            <ul className="grid grid-cols-3 gap-2">
              {all.slice(0, MAX_SHOWN).map((v, n) => {
                const on = inUse[key] === v.id;
                const no = all.length - n;
                const what = versionLabel(v);
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      disabled={busy || on}
                      aria-pressed={on}
                      aria-label={`${label} version ${no}, ${what}${on ? ", in use" : ". Use this version"}`}
                      onClick={() => onUse(key, v.id)}
                      className={`block w-full rounded-xs overflow-hidden border text-left transition-colors ${on ? "border-ink ring-1 ring-ink" : "border-hairline hover:border-line-strong"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.url} alt="" loading="lazy" draggable={false} className="block w-full aspect-square object-cover bg-field" />
                      <span className={`block px-1.5 py-1 text-[0.6875rem] leading-tight ${on ? "bg-ink text-on-ink" : "bg-paper text-ink-muted"}`}>
                        {no} · {on ? "in use" : what}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p className="text-xs text-ink-faint">Newest first. Choosing one puts it on the visual; ⌘Z takes you back.</p>
    </div>
  );
}

/**
 * Under a visual whose picture has a heading drawn into it. `stale`: the piece's
 * heading has changed since the picture was drawn. Otherwise the heading is
 * drawn in and nothing checks its spelling (no OCR), so the person does.
 * Either way the two actions are here: redraw the picture, or switch to live text.
 */
export function HeadingCheck({ stale, busy, onRedraw, onLiveText }: { stale: boolean; busy: boolean; onRedraw: () => void; onLiveText: () => void }) {
  return (
    <div role="note" className="mt-2 text-xs text-ink-muted leading-relaxed" onPointerDown={(e) => e.stopPropagation()}>
      <p>
        {stale
          ? "The heading changed since this picture was drawn, so the picture still shows the old one. Either choice draws a new picture."
          : "The heading may not be spelled right: it is drawn into the picture, and the app does not check it. Read it before you post; redraw the picture or switch to live text if it is wrong."}
      </p>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        <button type="button" disabled={busy} onClick={onRedraw} className={btnClass("secondary", "sm")}>{stale ? "Redraw with the new heading" : "Redraw the heading"}</button>
        <button type="button" disabled={busy} onClick={onLiveText} className={btnClass("ghost", "sm")}>Switch to live text</button>
      </div>
    </div>
  );
}

/**
 * Under a visual whose picture should carry no words (the heading is live text
 * on top) and may still show some: the check after drawing found words it
 * could not remove. Plain words, no buttons: Erase is in the tool strip.
 */
export function WordsNote() {
  return <p role="note" className="mt-2 text-xs text-ink-muted leading-relaxed">{WORDS_NOTICE}</p>;
}

export function ExportSizes() {
  return (
    <ul className="text-xs flex flex-col gap-2">
      {exportSizes(FORMATS).map((row) => (
        <li key={row.size} className="flex justify-between gap-3">
          <span className="text-ink-muted">{row.formats.join(", ")}</span>
          <span className="tabular-nums shrink-0">{row.size}</span>
        </li>
      ))}
    </ul>
  );
}

/** Does text set in `name` come out different from every generic fallback? Then the font is really there. */
function fontRenders(name: string): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const sample = "mmmmmmmmmmlliWQ@#gy 0123456789";
  const width = (font: string) => { ctx.font = `72px ${font}`; return ctx.measureText(sample).width; };
  return ["monospace", "serif", "sans-serif"].some((base) => width(`"${name.replace(/"/g, "")}", ${base}`) !== width(base));
}

/**
 * Whether the brand's font is rendering in this browser: undefined until it
 * has been measured (and when there is no brand font). A name in the brand
 * core is not a font on the page; the look check must not credit it unseen.
 */
export function useFontRenders(name: string | undefined): boolean | undefined {
  const [seen, setSeen] = useState<{ name: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!name) return;
    let live = true;
    const check = () => { if (live) setSeen({ name, ok: fontRenders(name) }); };
    void document.fonts.ready.then(check);
    // Ask for the face now (an @font-face rule or Google's stylesheet loads on
    // first use), so the measure below sees it as soon as it has arrived.
    void document.fonts.load(`72px "${name.replace(/"/g, "")}"`).then(check, check);
    document.fonts.addEventListener("loadingdone", check);
    return () => { live = false; document.fonts.removeEventListener("loadingdone", check); };
  }, [name]);
  return name && seen?.name === name ? seen.ok : undefined;
}

export type FitState = "ok" | "shrunk" | "clamped";

/**
 * How each piece's text fitted, by piece id: the worst of its text blocks.
 * Read from the `data-fit` the layouts write on every text block inside a
 * `[data-piece]` section, and read again whenever one of them changes.
 */
export function useFitStates(): Record<string, FitState> {
  const [fits, setFits] = useState<Record<string, FitState>>({});
  useEffect(() => {
    let raf = 0;
    const scan = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next: Record<string, FitState> = {};
        document.querySelectorAll<HTMLElement>("[data-piece]").forEach((el) => {
          const id = el.dataset.piece;
          if (id) next[id] = el.querySelector("[data-fit='clamped']") ? "clamped" : el.querySelector("[data-fit='shrunk']") ? "shrunk" : "ok";
        });
        setFits((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-fit"] });
    return () => { cancelAnimationFrame(raf); mo.disconnect(); };
  }, []);
  return fits;
}
