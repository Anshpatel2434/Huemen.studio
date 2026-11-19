"use client";

/**
 * The visual board's picture and comment tools.
 *
 *   PictureMenu     add a picture to one visual (heading as live text on top,
 *                   or drawn into the picture), draw a new one, go back a
 *                   version, download a cut-out, take it off
 *   CommentSurface  in Comment mode, click a part of a visual (or drag a box):
 *                   a numbered pin appears with a field beside it. Add several,
 *                   then one Send in the tool strip applies them all. The part
 *                   under the pin is picked for you (picture, heading, body,
 *                   call to action, logo, background) and can be changed in the
 *                   field. Sent comments show as numbered pins with what happened.
 *   DraftField      the field beside a pin that is not sent yet (shared with
 *                   Markup, picture-tools-ui)
 *   pictureArea, picturePoint
 *                   a box or a point on a visual, as a share of the PICTURE on it
 *   useJobWatch     follows queued picture work until it finishes
 *
 * Huemen components only: no browser dialogs, selects or prompts.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, X } from "lucide-react";
import { AgentDots, Menu, MenuItem, MenuSeparator } from "@/components/ui";
import { BoardIconButton } from "./visual-panels";
import { btnClass } from "@/components/btn";
import type { JobView } from "@/lib/jobs/types";
import type { ArtboardKind, PictureMode } from "@/lib/visual/design";
import type { VisualComment } from "@/lib/data/visual-comments";
import type { Box } from "@/lib/visual/region-types";
import { PICTURE_BUDGET, usesPictures, type PinKind, type Stroke } from "@/lib/visual/picture-tools";
import { placePins } from "@/lib/visual/pins";
import { boxIn, pictureRectIn, pointIn, rectOfBox, type Point, type Rect } from "./picture-tools-maths";

export type Target = VisualComment["target"];
export const TARGET_LABEL: Record<Target, string> = {
  picture: "Picture", headline: "Heading", body: "Body", cta: "Call to action", logo: "Logo", background: "Background",
};
const TARGET_ORDER: Target[] = ["picture", "headline", "body", "cta", "logo", "background"];

/** What a sent comment was about: the part, or the tool when it was drawn on the picture. */
export const commentWhat = (c: VisualComment): string =>
  c.target === "picture" && c.kind === "markup" ? "Markup" : c.target === "picture" && c.kind === "erase" ? "Erase" : TARGET_LABEL[c.target];

/**
 * A change that is pinned on a visual but not sent yet. `box` is on the
 * visual's frame (where the pin shows); `area` and `strokes` are on the
 * picture itself (lib/visual/picture-tools).
 */
export type DraftPin = {
  id: string;
  itemId: string;
  artboard: ArtboardKind;
  visualId: string;
  kind: PinKind;
  target: Target;
  box: Box;
  area: Box | null;
  /** A one-click pin (no dragged box): the server may widen its area when the change does not fit. */
  auto?: boolean;
  strokes?: Stroke[];
  note: string;
  /** Which frame of the visual the box is on (a carousel has several). */
  frame: number;
  /** The parts a comment on that frame can be about. */
  offered: Target[];
  /** Where the whole picture sits on that frame, in shares of the frame: puts a box on the picture back on the frame. */
  pic?: Box;
  /** The picture's shape, width over height (a stroke's width is a share of its shorter side). */
  aspect?: number;
  /** Why it didn't go through when it was sent; it stays pinned with this (PI-32). */
  error?: string;
};
/** A draft as a surface makes it; the board adds whose it is. */
export type NewDraft = Omit<DraftPin, "id" | "itemId" | "artboard" | "visualId">;
export type DraftOps = {
  /** False when it wasn't taken (the limit is reached, or there is no visual to pin it on). */
  add: (d: NewDraft) => boolean;
  update: (id: string, patch: Partial<Pick<DraftPin, "note" | "target">>) => void;
  remove: (id: string) => void;
  /** Which draft's field is open; null closes it. */
  open: (id: string | null) => void;
};

// ---- watching queued picture work ------------------------------------------------

export type Watched = {
  jobId: string; contentItemId: string; artboard: string; label: string;
  /** The picture before this job, for undo. */ prev?: string | null;
  /** What to say when it is done (else "Picture ready"). */ done?: string;
  /** Set while the job waits after a failed try: why it failed and when it tries again. */
  retrying?: { error: string; at: string; attempt: number; of: number } | null;
  /** Started in another tab (or by someone else): this board shows it, its undo is theirs (PI-27). */
  foreign?: boolean;
};

/** Why a job stopped being watched without finishing (PI-28). */
export type Lost = "signed_out" | "gone" | "slow";
/** After this long a job is still watched, but the board says so and offers Stop. */
export const WATCH_SLOW_MS = 10 * 60 * 1000;

/**
 * Polls each watched job; calls onDone once per job when it stops (succeeded,
 * failed or dead). A reply that can never turn into an answer is not polled
 * for ever (PI-28): signed out (401) or the job gone (404) stops the watch
 * and calls onLost; a job still going after WATCH_SLOW_MS calls onLost once
 * with "slow" and is still watched.
 */
export function useJobWatch(tenantId: string, initial: Watched[], onDone: (w: Watched, job: JobView) => void, onLost?: (w: Watched, why: Lost) => void) {
  const [watching, setWatching] = useState<Watched[]>(initial);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  const lost = useRef(onLost);
  useEffect(() => { lost.current = onLost; }, [onLost]);
  /** When each job was first watched here, and the slow ones already said. */
  const since = useRef(new Map<string, number>());
  const slowSaid = useRef(new Set<string>());
  const current = useRef(watching);
  useEffect(() => { current.current = watching; }, [watching]);
  // Polling restarts only when the set of jobs changes, not when a card's retry note does.
  const jobIds = watching.map((w) => w.jobId).join(",");
  useEffect(() => {
    if (!jobIds) return;
    let stop = false;
    const ids = jobIds.split(",");
    const tick = async () => {
      for (const id of ids) {
        try {
          const res = await fetch(`/w/${tenantId}/jobs/${id}`, { cache: "no-store" });
          if (stop) continue;
          if (res.status === 401 || res.status === 404) {
            const w = current.current.find((x) => x.jobId === id);
            setWatching((all) => all.filter((x) => x.jobId !== id));
            if (w) lost.current?.(w, res.status === 401 ? "signed_out" : "gone");
            continue;
          }
          if (!res.ok) continue;
          const job = (await res.json()) as JobView;
          if (job.status === "queued" || job.status === "running") {
            if (!since.current.has(id)) since.current.set(id, Date.now());
            if (Date.now() - since.current.get(id)! > WATCH_SLOW_MS && !slowSaid.current.has(id)) {
              slowSaid.current.add(id);
              const w = current.current.find((x) => x.jobId === id);
              if (w) lost.current?.(w, "slow");
            }
            // A try failed and the job waits for the next: say so on the card,
            // rather than "Drawing" through the wait.
            const retrying = job.status === "queued" && job.attempts > 0 && job.error
              ? { error: job.error, at: job.runAfter, attempt: job.attempts + 1, of: job.maxAttempts }
              : null;
            setWatching((all) => all.map((x) => (x.jobId === id && JSON.stringify(x.retrying ?? null) !== JSON.stringify(retrying) ? { ...x, retrying } : x)));
            continue;
          }
          const w = current.current.find((x) => x.jobId === id);
          if (!w) continue;
          setWatching((all) => all.filter((x) => x.jobId !== w.jobId));
          done.current(w, job);
        } catch {
          // Offline for a moment: the next tick tries again.
        }
      }
    };
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [tenantId, jobIds]);
  const watch = useCallback((w: Watched) => setWatching((all) => [...all.filter((x) => x.jobId !== w.jobId), w]), []);
  const unwatch = useCallback((jobId: string) => setWatching((all) => all.filter((x) => x.jobId !== jobId)), []);
  return { watching, watch, unwatch };
}

/** Seconds until an ISO time, never below 0. */
const secondsUntil = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));

/**
 * Shown over a visual while its picture is being drawn or changed. When a try
 * has failed and the next is waiting, it says why and when, with a countdown,
 * instead of looking busy.
 */
export function WorkingOverlay({ label, retrying }: { label: string; retrying?: Watched["retrying"] }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!retrying) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [retrying]);
  const left = retrying ? secondsUntil(retrying.at) : 0;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,var(--paper)_80%,transparent)] backdrop-blur-[2px] pointer-events-none p-6">
      {retrying ? (
        <div role="status" className="max-w-[80%] text-center text-sm text-ink">
          <p className="font-medium">{left > 0 ? `Trying again in ${left < 60 ? `${left}s` : `${Math.ceil(left / 60)} min`}` : "Trying again now"} (try {retrying.attempt} of {retrying.of})</p>
          <p className="mt-1 text-ink-muted">{retrying.error}</p>
        </div>
      ) : (
        <span role="status" className="inline-flex items-center gap-2 text-sm font-medium text-ink text-center"><AgentDots /> {label}</span>
      )}
    </div>
  );
}

// ---- the picture menu ---------------------------------------------------------------

/** The picture menu's width (18rem) on screen, at most the screen less its gutters. */
const MENU_W = 288;
/** Space kept between the menu and the screen's edges. */
const MENU_GUTTER = 8;

/**
 * Where the menu goes on screen: under the button, its right edge on the
 * button's right edge when there is room, else its left edge on the button's
 * left edge, and never past either side of the screen (PI-09: at 375 px it ran
 * off the right edge). Above the button when there is no room below. Pure.
 */
export function menuPlace(button: { left: number; right: number; top: number; bottom: number }, screen: { width: number; height: number }, menuHeight: number): { left: number; top: number; width: number } {
  const width = Math.min(MENU_W, screen.width - 2 * MENU_GUTTER);
  let left = button.right - width;
  if (left < MENU_GUTTER) left = button.left;
  left = Math.max(MENU_GUTTER, Math.min(left, screen.width - width - MENU_GUTTER));
  const below = button.bottom + 6;
  const top = below + menuHeight > screen.height - MENU_GUTTER && button.top - 6 - menuHeight >= MENU_GUTTER ? button.top - 6 - menuHeight : below;
  return { left, top, width };
}

export function PictureMenu({ has, mode, hasPrevious, busy, cutout = null, onDraw, onPrevious, onRemove }: {
  has: boolean; mode: PictureMode | null; hasPrevious: boolean; busy: boolean;
  /** The picture is a cut-out (its background removed): its transparent PNG, and the name to save it under. */
  cutout?: { url: string; name: string } | null;
  onDraw: (mode: PictureMode) => void; onPrevious: () => void; onRemove: () => void;
}) {
  // The menu is drawn at screen size, in a layer of its own over the page
  // (not inside the zoomed canvas), placed by menuPlace so all of it is on
  // screen at any width and any zoom.
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const place = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(menuPlace(r, { width: window.innerWidth, height: window.innerHeight }, menu.current?.offsetHeight ?? 0));
  }, []);
  // Measured once it is on the page (its height decides above or below), and again when the screen changes.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setOpen(false); };
    // Escape closes the menu and nothing else: the tool in use stays (PI-05).
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } };
    // The canvas moving under it (a scroll or a pinch) would leave it hanging away from its button.
    const away = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc, true);
    document.addEventListener("wheel", away, { passive: true });
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc, true); document.removeEventListener("wheel", away); };
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  const toggle = () => {
    if (open) return setOpen(false);
    setPos(null);
    setOpen(true);
  };
  return (
    <div ref={ref} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      {/* aria-expanded reaches the button here (the shared IconButton dropped it). */}
      <BoardIconButton label={has ? "Picture" : "Add a picture"} onClick={toggle} disabled={busy} expanded={open}>
        <ImagePlus size={14} aria-hidden="true" />
      </BoardIconButton>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menu}
          className="fixed"
          // Hidden for the one frame before it is placed, so it never shows in the wrong spot.
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, width: pos?.width ?? MENU_W, visibility: pos ? "visible" : "hidden", zIndex: "var(--z-popover)" }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Menu label="Picture">
            {!has ? (
              <>
                <MenuItem onClick={pick(() => onDraw("live_text"))}>Add a picture, heading kept as text</MenuItem>
                <MenuItem onClick={pick(() => onDraw("with_text"))}>Add a picture with the heading drawn in</MenuItem>
              </>
            ) : (
              <>
                <MenuItem onClick={pick(() => onDraw(mode ?? "live_text"))}>Draw a new picture</MenuItem>
                {mode === "with_text"
                  ? <MenuItem onClick={pick(() => onDraw("live_text"))}>Make the heading editable text again</MenuItem>
                  : <MenuItem onClick={pick(() => onDraw("with_text"))}>Draw the heading into the picture</MenuItem>}
                {hasPrevious && <MenuItem onClick={pick(onPrevious)}>{cutout ? "Back to the version before" : "Back to the previous version"}</MenuItem>}
                {/* A real download link (the picture's own same-origin link), never a new window. */}
                {cutout && (
                  <a role="menuitem" href={cutout.url} download={cutout.name} onClick={() => setOpen(false)} className="hu-menu__item">
                    <span className="flex-1 truncate">Download cut-out</span>
                  </a>
                )}
                <MenuSeparator />
                <MenuItem danger onClick={pick(onRemove)}>Take the picture off</MenuItem>
              </>
            )}
            {/* What a new picture costs, said before it is drawn (PI-30). */}
            <p className="px-3 pt-1 pb-2 text-xs text-ink-faint leading-snug">A new picture: {usesPictures(PICTURE_BUDGET.draw).toLowerCase()} (the extra ones only if it has to clean up stray words).</p>
          </Menu>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---- where the picture is ---------------------------------------------------------------

const rectOf = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/**
 * The picture on a visual, on screen: the slot the layout gives it, and where
 * the WHOLE picture sits (it is cropped to the slot, centred, or sits whole
 * inside it when it is a cut-out). `within` is the visual's frame, or anything
 * that holds its picture. Reads layout: handlers and animation frames only.
 */
export function pictureOnScreen(within: HTMLElement): { img: HTMLImageElement; slot: Rect; full: Rect; natural: { w: number; h: number } } | null {
  const img = within.querySelector<HTMLImageElement>("img[data-part='picture']");
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const slot = rectOf(img.getBoundingClientRect());
  const natural = { w: img.naturalWidth, h: img.naturalHeight };
  const fit = getComputedStyle(img).objectFit === "contain" ? "contain" : "cover";
  return { img, slot, full: pictureRectIn(slot, natural, fit), natural };
}

/**
 * The box (fractions of the visual frame) as fractions of the PICTURE itself:
 * through where the picture sits in the layout and how it is cropped to its
 * slot. The redraw works in the picture's pixels, which differ from the
 * frame's whenever the picture is cropped or fills only part of the frame.
 */
export function pictureArea(frame: HTMLElement, box: Box): Box | null {
  const p = pictureOnScreen(frame);
  // Keep the part that is on the picture; the server cleans it again.
  return p ? boxIn(p.full, rectOfBox(rectOf(frame.getBoundingClientRect()), box)) : null;
}

/** A point on the screen as a share of the picture on this visual (kept on the picture); null when it has none. */
export function picturePoint(frame: HTMLElement, clientX: number, clientY: number): Point | null {
  const p = pictureOnScreen(frame);
  return p ? pointIn(p.full, clientX, clientY) : null;
}

// ---- comment on a spot -----------------------------------------------------------------

const STATUS_TONE: Record<VisualComment["status"], string> = {
  open: "border-[var(--accent)]", working: "border-[var(--accent)]", applied: "border-[var(--ok-line)]", failed: "border-[var(--danger-line)]",
};
const UNDONE_TONE = "border-dashed border-[var(--line-strong)]";

/**
 * What sending a comment on each part does, said in the field before it is
 * sent: exactly what changes (PI-13: a comment on one slide's words rewrote
 * the whole post while this said "this text"), and what a picture change can
 * cost (PI-30). `slide`: the comment is on a carousel slide.
 */
export function targetHint(t: Target, slide: boolean): string {
  switch (t) {
    case "picture": return `Only this area of the picture is redrawn; drag a bigger box for a bigger change. ${usesPictures(PICTURE_BUDGET.comment)}.`;
    case "headline": return slide ? "Rewrites the heading in your voice. It is the post's opening line, so the post image and quote card change too." : "Rewrites the heading in your voice, on all three visuals of this piece.";
    case "body": return slide ? "Rewrites the words on this slide only, in your voice. The post's body changes with them." : "Rewrites the post's body in your voice. Every slide that shows it changes too.";
    case "cta": return slide ? "Rewrites the call to action on this slide, in your voice. It is the post's call to action too." : "Rewrites the call to action in your voice.";
    case "logo":
    case "background": return slide ? "Changes the design of all three visuals of this piece, every slide included." : "Changes the design of all three visuals of this piece.";
  }
}

/**
 * What became of a comment, in the words the pin and the side panel both use.
 * `undone`: a picture change that is no longer in the picture (Ctrl+Z, or an
 * earlier version put back); the comment was applied, but its result is gone.
 */
export function commentState(c: VisualComment, undone = false): { label: string; text: string } {
  if (c.status === "working") return { label: "working", text: "Working on it" };
  if (undone) return { label: "undone", text: "Undone. The picture is back to a version without this change." };
  if (c.status === "applied") return { label: "done", text: c.result ?? "Done." };
  if (c.status === "failed") return { label: "didn't go through", text: c.result ?? "That didn't go through." };
  return { label: "waiting", text: "Waiting" };
}

/** The parts present in a frame, in a fixed order. */
function partsIn(frame: HTMLElement): Target[] {
  const found = new Set<Target>(["background"]);
  frame.querySelectorAll<HTMLElement>("[data-part]").forEach((el) => {
    const p = el.dataset.part as Target;
    if (TARGET_ORDER.includes(p)) found.add(p);
  });
  return TARGET_ORDER.filter((t) => found.has(t));
}

/** The topmost part under a point, inside this frame. */
function partAt(frame: HTMLElement, x: number, y: number): Target {
  // Layers that only hold other parts (the text block over a picture) resolve
  // to the frame itself; keep looking down the stack for something specific.
  for (const el of document.elementsFromPoint(x, y)) {
    if (!frame.contains(el)) continue;
    const part = (el as HTMLElement).closest<HTMLElement>("[data-part]");
    if (part && frame.contains(part)) {
      const p = part.dataset.part as Target;
      if (TARGET_ORDER.includes(p) && p !== "background") return p;
    }
  }
  return "background";
}

/** The box a click on a visual makes, centred on the point (fractions of the frame), kept on the frame. Pure. */
export function clickBox(px: number, py: number, picture: boolean): Box {
  const w = picture ? 0.3 : 0.16, h = picture ? 0.24 : 0.12;
  const x = Math.max(0, Math.min(1 - w, px - w / 2));
  const y = Math.max(0, Math.min(1 - h, py - h / 2));
  return { x, y, w, h };
}

/** The field's width on screen, whatever the canvas zoom. */
const FIELD_W = 252;

/**
 * The field beside a pin that is not sent yet: what the change is about (the
 * part chips, for a comment), the words, and a small remove button. Enter
 * moves on; Escape closes it (and takes an empty pin away).
 *
 * It sits inside the visual's own layer (no dialog, nothing floating) and is
 * drawn at screen size whatever the canvas zoom: the canvas publishes its zoom
 * as --cv-z, and the field is scaled by its inverse. Under the pin's box, or
 * over it when the box is low on the visual. `rect` is the box, in the
 * surface's own (unzoomed) pixels.
 */
export function DraftField({ rect, flip, label, chips, note, onNote, placeholder, hint, error, onEnter, onEscape, onRemove, removeLabel }: {
  rect: Rect; flip: boolean; label: string;
  chips?: { label: string; value: Target; items: Target[]; onChange: (t: Target) => void };
  note: string; onNote: (v: string) => void; placeholder: string; hint?: string;
  /** Why the last Send of this change didn't go through. */
  error?: string;
  onEnter: () => void; onEscape: () => void; onRemove: () => void; removeLabel: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Focus once, when the field appears (and again after a chip is picked): a
  // field that took focus on every render would pull it off the chips.
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return (
    <div
      role="group"
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-40 bg-paper border border-hairline rounded-md shadow-[var(--shadow-lg)] p-2 flex flex-col gap-2 cursor-default text-left fade-in pointer-events-auto"
      style={{
        width: FIELD_W,
        // Never past the visual's right edge at this zoom, never before its left.
        left: `max(0px, min(${rect.left.toFixed(1)}px, calc(100% - ${FIELD_W}px / var(--cv-z, 1))))`,
        ...(flip ? { bottom: `calc(100% - ${(rect.top - 16).toFixed(1)}px)` } : { top: rect.top + rect.height + 8 }),
        transform: "scale(calc(1 / var(--cv-z, 1)))",
        transformOrigin: flip ? "bottom left" : "top left",
      }}
    >
      {chips && chips.items.length > 1 && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={chips.label}>
          {chips.items.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={chips.value === t}
              onClick={() => { chips.onChange(t); input.current?.focus({ preventScroll: true }); }}
              className={`min-h-8 px-2.5 rounded-full border text-xs ${chips.value === t ? "bg-ink text-on-ink border-ink" : "border-line hover:border-line-strong"}`}
            >
              {TARGET_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          ref={input}
          value={note}
          maxLength={500}
          onChange={(e) => onNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onEnter(); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEscape(); }
          }}
          placeholder={placeholder}
          aria-label="What to change"
          enterKeyHint="done"
          className="field !min-h-11 !py-2 flex-1 min-w-0"
        />
        <BoardIconButton label={removeLabel} onClick={onRemove}><X size={14} aria-hidden="true" /></BoardIconButton>
      </div>
      {error && <p role="alert" className="text-xs text-danger leading-snug">Not sent: {error}</p>}
      {hint && <p className="text-xs text-ink-faint leading-snug">{hint}</p>}
    </div>
  );
}

/** A numbered pin that is not sent yet. With `onOpen` it is a button that opens its field. */
export function DraftDot({ no, at, note, open, onOpen }: { no: number; at: { left: number; top: number }; note: string; open?: boolean; onOpen?: () => void }) {
  const cls = `absolute z-20 w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center ring-2 ring-paper bg-accent text-accent-fg ${note.trim() ? "" : "outline outline-1 outline-dashed outline-offset-2 outline-[var(--accent)]"}`;
  if (!onOpen) return <span aria-hidden="true" className={cls} style={at}>{no}</span>;
  return (
    <button
      type="button"
      data-pin=""
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onOpen}
      aria-expanded={!!open}
      aria-label={`Change ${no}, not sent yet${note.trim() ? `: ${note.trim()}` : ". Needs a comment"}`}
      className={`${cls} pointer-events-auto`}
      style={at}
    >
      {no}
    </button>
  );
}

/**
 * Wraps one visual. `off`: just the visual. `on` (the Comment tool): a click
 * (or a dragged box) adds a numbered pin with a field beside it; the pins wait
 * for Send in the tool strip. `show` (another picture tool is in use): the
 * pins are drawn but nothing here takes a click.
 *
 * Boxes are kept as fractions of the frame they were drawn on, so they hold at
 * any zoom and in the full-size export. Positions on screen are measured in
 * event handlers and an animation frame, never during render.
 */
export function CommentSurface({ mode, comments, numbers, isUndone, drafts, draftNumbers, openDraft, onDraft, pictureLock, onRefuse, onRetry, onDismiss, slides = false, children }: {
  mode: "off" | "show" | "on";
  /** The visual is a carousel: a comment is on one slide, and its hint says so. */
  slides?: boolean;
  /** Earlier comments on this visual, oldest first. */
  comments: VisualComment[];
  /** The number each comment carries: its place among the PIECE's comments, the same as in the side panel. */
  numbers?: Record<string, number>;
  /** A picture change that has since been undone (the picture in use isn't the one it made). */
  isUndone?: (c: VisualComment) => boolean;
  /** This visual's comments that are not sent yet, in the order they were made. */
  drafts: DraftPin[];
  /** The number each draft carries: after the piece's sent comments. */
  draftNumbers: Record<string, number>;
  /** The draft whose field is open, if it is one of these. */
  openDraft: string | null;
  onDraft: DraftOps;
  /** Why this visual's picture can't take a comment right now, when it can't. */
  pictureLock?: string | null;
  /** A click was refused: say why. */
  onRefuse?: (why: string) => void;
  /** Run a comment that didn't go through again. */
  onRetry?: (c: VisualComment) => Promise<void>;
  onDismiss: (id: string) => void;
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; frame: HTMLElement } | null>(null);
  const [live, setLive] = useState<Rect | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [openPin, setOpenPin] = useState<string | null>(null);
  // Where each sent comment and each draft sits, and how tall the visual is (a field low on it opens upwards).
  const [pins, setPins] = useState<Record<string, Rect>>({});
  const [height, setHeight] = useState(0);
  const on = mode === "on";

  // Leaving comment mode drops a box being dragged and closes an open pin (state adjusted during render, not in an effect).
  const [wasOn, setWasOn] = useState(on);
  if (wasOn !== on) {
    setWasOn(on);
    if (!on) { setLive(null); setOpenPin(null); }
  }

  const framesOf = () => (wrap.current ? [...wrap.current.querySelectorAll<HTMLElement>("[data-part='background']")] : []);

  /** A box on a frame, in the wrapper's own (unzoomed) pixels. Reads layout: handlers and frames only. */
  const rectIn = useCallback((frame: HTMLElement, b: Box): Rect | null => {
    const w = wrap.current?.getBoundingClientRect();
    const r = frame.getBoundingClientRect();
    if (!w || !wrap.current) return null;
    const z = w.width / (wrap.current.offsetWidth || w.width) || 1;
    return { left: (r.left - w.left + b.x * r.width) / z, top: (r.top - w.top + b.y * r.height) / z, width: (b.w * r.width) / z, height: (b.h * r.height) / z };
  }, []);

  // The drafts change with every key typed; they are measured again only when one moves, comes or goes.
  const draftsNow = useRef(drafts);
  useEffect(() => { draftsNow.current = drafts; }, [drafts]);
  const draftKey = drafts.map((d) => `${d.id}:${d.frame}:${d.box.x},${d.box.y},${d.box.w},${d.box.h}`).join("|");

  // Where the pins sit, measured after layout (and again if the visual resizes).
  useEffect(() => {
    if (mode === "off" || !wrap.current) return;
    const el = wrap.current;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const out: Record<string, Rect> = {};
        const frames = [...el.querySelectorAll<HTMLElement>("[data-part='background']")];
        for (const c of comments) {
          // On the frame it was put on (PI-12); an older comment, with none stored, on the first frame with its part.
          const part = el.querySelector(`[data-part='${c.target}']`);
          const frame = (c.frame !== null ? frames[c.frame] : undefined) ?? part?.closest<HTMLElement>("[data-part='background']") ?? frames[0];
          const rect = frame ? rectIn(frame, c.box) : null;
          if (rect) out[c.id] = rect;
        }
        for (const d of draftsNow.current) {
          const frame = frames[d.frame] ?? frames[0];
          const rect = frame ? rectIn(frame, d.box) : null;
          if (rect) out[d.id] = rect;
        }
        setPins(out);
        setHeight(el.offsetHeight);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [mode, comments, draftKey, rectIn]);

  const frameAt = (x: number, y: number): HTMLElement | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!wrap.current?.contains(el)) continue;
      const f = (el as HTMLElement).closest<HTMLElement>("[data-part='background']");
      if (f) return f;
    }
    return null;
  };
  const frac = (frame: HTMLElement, a: { x: number; y: number }, b: { x: number; y: number }): Box => {
    const r = frame.getBoundingClientRect();
    const x0 = Math.max(0, Math.min(a.x, b.x) - r.left) / r.width;
    const y0 = Math.max(0, Math.min(a.y, b.y) - r.top) / r.height;
    const x1 = Math.min(r.width, Math.max(a.x, b.x) - r.left) / r.width;
    const y1 = Math.min(r.height, Math.max(a.y, b.y) - r.top) / r.height;
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };

  const down = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setOpenPin(null);
    const frame = frameAt(e.clientX, e.clientY);
    if (!frame) return;
    start.current = { x: e.clientX, y: e.clientY, frame };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const s0 = start.current;
    if (!s0) return;
    setLive(rectIn(s0.frame, frac(s0.frame, s0, { x: e.clientX, y: e.clientY })));
  };
  const cancel = () => { start.current = null; setLive(null); };
  const up = (e: React.PointerEvent) => {
    const s0 = start.current;
    start.current = null;
    setLive(null);
    if (!s0) return;
    let box = frac(s0.frame, s0, { x: e.clientX, y: e.clientY });
    const r = s0.frame.getBoundingClientRect();
    let target: Target;
    const clicked = box.w < 0.03 || box.h < 0.03;
    // A click, not a drag: a box around the point. On the picture it is a room-sized
    // one (PI-18: a 16% x 12% box made the model draw a plant cut off at its edge);
    // on the words, a small one that only says where the pin goes.
    if (clicked) {
      target = partAt(s0.frame, s0.x, s0.y);
      box = clickBox((s0.x - r.left) / r.width, (s0.y - r.top) / r.height, target === "picture");
    } else {
      target = partAt(s0.frame, r.left + (box.x + box.w / 2) * r.width, r.top + (box.y + box.h / 2) * r.height);
    }
    if (target === "picture" && pictureLock) return onRefuse?.(pictureLock);
    const frame = Math.max(0, framesOf().indexOf(s0.frame));
    const offered = partsIn(s0.frame).filter((t) => t !== "picture" || !pictureLock);
    onDraft.add({ kind: "comment", target, box, area: pictureArea(s0.frame, box), ...(clicked && target === "picture" ? { auto: true } : {}), note: "", frame, offered });
  };

  const undone = (c: VisualComment) => !!isUndone?.(c);
  // Pins are numbered and placed in the order given, sent ones first; one that would cover another moves aside (lib/visual/pins).
  const spots = placePins([...comments, ...drafts].flatMap((c) => (pins[c.id] ? [{ id: c.id, left: pins[c.id].left, top: pins[c.id].top }] : [])));
  const retry = async (c: VisualComment) => {
    if (!onRetry) return;
    setRetrying(c.id);
    try {
      await onRetry(c);
    } finally {
      setRetrying(null);
    }
  };

  const opened = on ? drafts.find((d) => d.id === openDraft && pins[d.id]) : undefined;
  // The layer with an open field or note rises over its neighbours, so what reaches past this visual is not under theirs.
  const raised = !!opened || !!openPin;

  return (
    <div ref={wrap} className="relative">
      {children}
      {mode !== "off" && (
        <div
          className={`absolute inset-0 ${raised ? "z-30" : "z-20"} ${on ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
          onPointerDown={on ? down : undefined}
          onPointerMove={on ? move : undefined}
          onPointerUp={on ? up : undefined}
          onPointerCancel={on ? cancel : undefined}
          role="group"
          aria-label={on ? "Click a part of this visual to comment on it" : "Comments on this visual"}
        >
          {/* The boxes first, then the pins over all of them, so a pin is never under another comment's box. */}
          {comments.map((c) => pins[c.id] && (
            <div key={c.id} className={`absolute border-2 rounded-xs pointer-events-none ${undone(c) ? UNDONE_TONE : STATUS_TONE[c.status]}`} style={pins[c.id]} />
          ))}
          {drafts.map((d) => pins[d.id] && (
            <div key={d.id} className={`absolute border-2 rounded-xs pointer-events-none border-[var(--accent)] ${d.id === opened?.id ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" : "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"}`} style={pins[d.id]} />
          ))}
          {comments.map((c, n) => {
            const at = spots[c.id];
            if (!at) return null;
            const no = numbers?.[c.id] ?? n + 1;
            const state = commentState(c, undone(c));
            return (
              <div key={c.id} data-pin="" className={`absolute ${openPin === c.id ? "z-30" : "z-20"}`} style={at}>
                <button
                  type="button"
                  tabIndex={on ? 0 : -1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setOpenPin(openPin === c.id ? null : c.id)}
                  className={`w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center ring-2 ring-paper ${undone(c) ? "bg-paper text-ink-muted border border-line-strong" : "bg-ink text-on-ink"}`}
                  aria-label={`Comment ${no}, ${state.label}: ${c.note}`}
                  aria-expanded={openPin === c.id}
                >
                  {no}
                </button>
                {on && openPin === c.id && (
                  <div onPointerDown={(e) => e.stopPropagation()} className="absolute left-0 top-full mt-2 w-64 bg-paper border border-hairline rounded-md shadow-[var(--shadow-lg)] p-3 text-left cursor-default">
                    <p className="text-xs text-ink-faint">{no} · {commentWhat(c)} · {state.label}</p>
                    <p className="text-sm mt-0.5">{c.note}</p>
                    <p className="text-xs mt-2 text-ink-muted whitespace-pre-line">
                      {c.status === "working" ? <span className="inline-flex items-center gap-1.5"><AgentDots /> Working on it</span> : state.text}
                    </p>
                    {c.status !== "working" && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {c.status === "failed" && onRetry && (
                          <button type="button" disabled={retrying === c.id} onClick={() => void retry(c)} className={btnClass("secondary", "sm")}>
                            {retrying === c.id ? <><AgentDots /> Trying again…</> : "Try again"}
                          </button>
                        )}
                        <button type="button" onClick={() => { setOpenPin(null); onDismiss(c.id); }} className={btnClass("ghost", "sm")}>Clear this comment</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {drafts.map((d) => spots[d.id] && (
            <DraftDot
              key={d.id}
              no={draftNumbers[d.id] ?? 0}
              at={spots[d.id]}
              note={d.note}
              open={d.id === opened?.id}
              onOpen={on ? () => { setOpenPin(null); onDraft.open(d.id === openDraft ? null : d.id); } : undefined}
            />
          ))}
          {live && <div className="absolute border-2 border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] pointer-events-none" style={live} />}
          {opened && (
            <DraftField
              key={opened.id}
              rect={pins[opened.id]}
              flip={height > 0 && pins[opened.id].top + pins[opened.id].height / 2 > height * 0.55}
              label={`Change ${draftNumbers[opened.id] ?? ""}`}
              chips={{ label: "What the comment is about", value: opened.target, items: opened.offered, onChange: (t) => onDraft.update(opened.id, { target: t }) }}
              note={opened.note}
              onNote={(v) => onDraft.update(opened.id, { note: v })}
              placeholder="Add a comment..."
              hint={targetHint(opened.target, slides)}
              error={opened.error}
              onEnter={() => { if (opened.note.trim()) onDraft.open(null); }}
              onEscape={() => (opened.note.trim() ? onDraft.open(null) : onDraft.remove(opened.id))}
              onRemove={() => onDraft.remove(opened.id)}
              removeLabel="Remove this comment"
            />
          )}
        </div>
      )}
    </div>
  );
}
