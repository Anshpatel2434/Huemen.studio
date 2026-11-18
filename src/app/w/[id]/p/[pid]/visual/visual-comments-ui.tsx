"use client";

/**
 * The visual board's picture and comment tools.
 *
 *   PictureMenu     add a picture to one visual (heading as live text on top,
 *                   or drawn into the picture), draw a new one, go back a
 *                   version, take it off
 *   CommentSurface  in comment mode, drag a box on a visual, say what to
 *                   change, Send. The part under the box is picked for you
 *                   (picture, headline, body, call to action, logo,
 *                   background) and can be changed before sending. Earlier
 *                   comments show as numbered boxes with what happened.
 *   useJobWatch     follows queued picture work until it finishes
 *
 * Huemen components only: no browser dialogs, selects or prompts.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, MessageSquare, X } from "lucide-react";
import { AgentDots, Menu, MenuItem, MenuSeparator } from "@/components/ui";
import { BoardIconButton } from "./visual-panels";
import { btnClass } from "@/components/btn";
import type { JobView } from "@/lib/jobs/types";
import type { PictureMode } from "@/lib/visual/design";
import type { VisualComment } from "@/lib/data/visual-comments";
import { placePins } from "@/lib/visual/pins";

export type Target = VisualComment["target"];
export const TARGET_LABEL: Record<Target, string> = {
  picture: "Picture", headline: "Heading", body: "Body", cta: "Call to action", logo: "Logo", background: "Background",
};
const TARGET_ORDER: Target[] = ["picture", "headline", "body", "cta", "logo", "background"];

// ---- watching queued picture work ------------------------------------------------

export type Watched = {
  jobId: string; contentItemId: string; artboard: string; label: string;
  /** The picture before this job, for undo. */ prev?: string | null;
  /** Set while the job waits after a failed try: why it failed and when it tries again. */
  retrying?: { error: string; at: string; attempt: number; of: number } | null;
};

/** Polls each watched job; calls onDone once per job when it stops (succeeded, failed or dead). */
export function useJobWatch(tenantId: string, initial: Watched[], onDone: (w: Watched, job: JobView) => void) {
  const [watching, setWatching] = useState<Watched[]>(initial);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
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
          if (!res.ok || stop) continue;
          const job = (await res.json()) as JobView;
          if (job.status === "queued" || job.status === "running") {
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
  return { watching, watch };
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
        <span role="status" className="inline-flex items-center gap-2 text-sm font-medium text-ink"><AgentDots /> {label}</span>
      )}
    </div>
  );
}

// ---- the picture menu ---------------------------------------------------------------

/** The picture menu's width (18rem), in the canvas's own unzoomed pixels. */
const MENU_W = 288;

export function PictureMenu({ has, mode, hasPrevious, busy, onDraw, onPrevious, onRemove }: {
  has: boolean; mode: PictureMode | null; hasPrevious: boolean; busy: boolean;
  onDraw: (mode: PictureMode) => void; onPrevious: () => void; onRemove: () => void;
}) {
  // Closed, or open towards the side that has room: the menu hangs from the
  // button's right edge unless that would run it off the canvas's left edge
  // (a visual at the left of the canvas), where it hangs from the left edge.
  const [open, setOpen] = useState<false | "left" | "right">(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  const toggle = () => {
    if (open) return setOpen(false);
    const el = ref.current;
    if (!el) return setOpen("left");
    const r = el.getBoundingClientRect();
    // The canvas zooms its content, so the menu's width on screen is 18rem times that zoom.
    const zoom = r.width / (el.offsetWidth || r.width) || 1;
    const edge = el.closest("[data-canvas-bg]")?.closest(".canvas-dots")?.getBoundingClientRect().left ?? 0;
    setOpen(r.right - MENU_W * zoom < edge + 8 ? "right" : "left");
  };
  return (
    <div ref={ref} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      {/* aria-expanded reaches the button here (the shared IconButton dropped it). */}
      <BoardIconButton label={has ? "Picture" : "Add a picture"} onClick={toggle} disabled={busy} expanded={!!open}>
        <ImagePlus size={14} aria-hidden="true" />
      </BoardIconButton>
      {open && (
        <div className={`absolute ${open === "right" ? "left-0" : "right-0"} top-9 z-30`} style={{ width: MENU_W }}>
          <Menu label="Picture">
            {!has ? (
              <>
                <MenuItem onClick={pick(() => onDraw("live_text"))}>Add a picture (heading stays editable text)</MenuItem>
                <MenuItem onClick={pick(() => onDraw("with_text"))}>Add a picture with the heading drawn in</MenuItem>
              </>
            ) : (
              <>
                <MenuItem onClick={pick(() => onDraw(mode ?? "live_text"))}>Draw a new picture</MenuItem>
                {mode === "with_text"
                  ? <MenuItem onClick={pick(() => onDraw("live_text"))}>Make the heading editable text again</MenuItem>
                  : <MenuItem onClick={pick(() => onDraw("with_text"))}>Draw the heading into the picture</MenuItem>}
                {hasPrevious && <MenuItem onClick={pick(onPrevious)}>Back to the previous version</MenuItem>}
                <MenuSeparator />
                <MenuItem danger onClick={pick(onRemove)}>Take the picture off</MenuItem>
              </>
            )}
          </Menu>
        </div>
      )}
    </div>
  );
}

// ---- comment on a spot -----------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number };
type Draft = { frame: HTMLElement; box: Box; target: Target; offered: Target[] };

/**
 * The box (fractions of the visual frame) as fractions of the PICTURE itself:
 * through where the picture sits in the layout and its object-cover crop
 * (centred). The redraw works in the picture's pixels, which differ from the
 * frame's whenever the picture is cropped or fills only part of the frame.
 */
function pictureArea(frame: HTMLElement, box: Box): Box | null {
  const img = frame.querySelector<HTMLImageElement>("img[data-part='picture']");
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const f = frame.getBoundingClientRect();
  const r = img.getBoundingClientRect();
  const s = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  const ox = r.left + (r.width - dw) / 2;
  const oy = r.top + (r.height - dh) / 2;
  const x = (f.left + box.x * f.width - ox) / dw;
  const y = (f.top + box.y * f.height - oy) / dh;
  const w = (box.w * f.width) / dw;
  const h = (box.h * f.height) / dh;
  // Keep the part that is on the picture; the server cleans it again.
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(1, x + w), y1 = Math.min(1, y + h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const STATUS_TONE: Record<VisualComment["status"], string> = {
  open: "border-[var(--accent)]", working: "border-[var(--accent)]", applied: "border-[var(--ok-line)]", failed: "border-[var(--danger-line)]",
};
const UNDONE_TONE = "border-dashed border-[var(--line-strong)]";

/** What sending a comment on each part does, said under the box before it is sent. */
const TARGET_HINT: Record<Target, string> = {
  picture: "Only the marked area of the picture is redrawn.",
  headline: "Rewrites this text in your voice. The heading is shared by this piece's post image, quote card and carousel cover.",
  body: "Rewrites this text in your voice.",
  cta: "Rewrites this text in your voice.",
  logo: "Changes the design of all three visuals of this piece: post image, quote card and carousel.",
  background: "Changes the design of all three visuals of this piece: post image, quote card and carousel.",
};

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

type Rect = { left: number; top: number; width: number; height: number };

/**
 * Wraps one visual. Off: just the visual. On: drag a box on it, then say what
 * to change. Boxes are kept as fractions of the frame they were drawn on, so
 * they hold at any zoom and in the full-size export. Positions on screen are
 * measured in event handlers and an animation frame, never during render.
 */
export function CommentSurface({ enabled, comments, numbers, isUndone, frameOf, onSend, onRetry, onDismiss, children }: {
  enabled: boolean;
  /** Earlier comments on this visual, oldest first. */
  comments: VisualComment[];
  /** The number each comment carries: its place among the PIECE's comments, the same as in the side panel. */
  numbers?: Record<string, number>;
  /** A picture change that has since been undone (the picture in use isn't the one it made). */
  isUndone?: (c: VisualComment) => boolean;
  /** Which frame an element is in (a carousel has several); defaults to the nearest frame. */
  frameOf?: (el: Element) => HTMLElement | null;
  onSend: (draft: { target: Target; box: Box; note: string; area?: Box | null }) => Promise<boolean>;
  /** Run a comment that didn't go through again. */
  onRetry?: (c: VisualComment) => Promise<void>;
  onDismiss: (id: string) => void;
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; frame: HTMLElement } | null>(null);
  const [live, setLive] = useState<Rect | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  // `at` is where the panel opens on screen: under the box, or over it when the screen ends first.
  const [draft, setDraft] = useState<(Omit<Draft, "frame"> & { rect: Rect; at: { left: number; top?: number; bottom?: number }; area: Box | null }) | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [pins, setPins] = useState<Record<string, Rect>>({});

  // Leaving comment mode drops a half-written comment (state adjusted during render, not in an effect).
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) { setDraft(null); setLive(null); setOpenPin(null); }
  }

  const nearestFrame = useCallback((el: Element): HTMLElement | null =>
    frameOf ? frameOf(el) : (el as HTMLElement).closest<HTMLElement>("[data-part='background']"), [frameOf]);

  /** A box on a frame, in the wrapper's own (unzoomed) pixels. Reads layout: handlers and frames only. */
  const rectOf = useCallback((frame: HTMLElement, b: Box): Rect | null => {
    const w = wrap.current?.getBoundingClientRect();
    const r = frame.getBoundingClientRect();
    if (!w || !wrap.current) return null;
    const z = w.width / (wrap.current.offsetWidth || w.width) || 1;
    return { left: (r.left - w.left + b.x * r.width) / z, top: (r.top - w.top + b.y * r.height) / z, width: (b.w * r.width) / z, height: (b.h * r.height) / z };
  }, []);

  // Where the saved comments sit, measured after layout (and again if the visual resizes).
  useEffect(() => {
    if (!enabled || !wrap.current) return;
    const el = wrap.current;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const out: Record<string, Rect> = {};
        const fallback = el.querySelector<HTMLElement>("[data-part='background']");
        for (const c of comments) {
          const part = el.querySelector(`[data-part='${c.target}']`);
          const frame = (part && nearestFrame(part)) ?? fallback;
          const rect = frame ? rectOf(frame, c.box) : null;
          if (rect) out[c.id] = rect;
        }
        setPins(out);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [enabled, comments, nearestFrame, rectOf]);

  const frameAt = (x: number, y: number): HTMLElement | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!wrap.current?.contains(el)) continue;
      const f = nearestFrame(el);
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
    if (e.button !== 0 || draft) return;
    const frame = frameAt(e.clientX, e.clientY);
    if (!frame) return;
    start.current = { x: e.clientX, y: e.clientY, frame };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const s0 = start.current;
    if (!s0) return;
    setLive(rectOf(s0.frame, frac(s0.frame, s0, { x: e.clientX, y: e.clientY })));
  };
  const up = (e: React.PointerEvent) => {
    const s0 = start.current;
    start.current = null;
    setLive(null);
    if (!s0) return;
    let box = frac(s0.frame, s0, { x: e.clientX, y: e.clientY });
    // A click, not a drag: a small box around the point.
    if (box.w < 0.03 || box.h < 0.03) {
      const r = s0.frame.getBoundingClientRect();
      const x = Math.max(0, (s0.x - r.left) / r.width - 0.08);
      const y = Math.max(0, (s0.y - r.top) / r.height - 0.06);
      box = { x, y, w: Math.min(0.16, 1 - x), h: Math.min(0.12, 1 - y) };
    }
    const r = s0.frame.getBoundingClientRect();
    const target = partAt(s0.frame, r.left + (box.x + box.w / 2) * r.width, r.top + (box.y + box.h / 2) * r.height);
    const rect = rectOf(s0.frame, box);
    if (!rect) return;
    const PANEL_W = 300, PANEL_H = 270, M = 12;
    const bx = { left: r.left + box.x * r.width, top: r.top + box.y * r.height, bottom: r.top + (box.y + box.h) * r.height };
    const left = Math.max(M, Math.min(bx.left, window.innerWidth - PANEL_W - M));
    const at = window.innerHeight - bx.bottom >= PANEL_H + M || bx.top < PANEL_H + M
      ? { left, top: Math.min(bx.bottom + 8, window.innerHeight - PANEL_H - M) }
      : { left, bottom: window.innerHeight - bx.top + 8 };
    setDraft({ box, target, offered: partsIn(s0.frame), rect, at, area: pictureArea(s0.frame, box) });
    setNote("");
  };

  const undone = (c: VisualComment) => !!isUndone?.(c);
  // Pins are numbered and placed in the order given; one that would cover another moves aside (lib/visual/pins).
  const spots = placePins(comments.flatMap((c) => (pins[c.id] ? [{ id: c.id, left: pins[c.id].left, top: pins[c.id].top }] : [])));
  const retry = async (c: VisualComment) => {
    if (!onRetry) return;
    setRetrying(c.id);
    try {
      await onRetry(c);
    } finally {
      setRetrying(null);
    }
  };

  const send = async () => {
    if (!draft || !note.trim()) return;
    setSending(true);
    const area = draft.target === "picture" ? draft.area : null;
    const ok = await onSend({ target: draft.target, box: draft.box, note: note.trim(), area });
    setSending(false);
    if (ok) { setDraft(null); setNote(""); }
  };

  return (
    <div ref={wrap} className="relative">
      {children}
      {enabled && (
        <div
          className="absolute inset-0 z-20 cursor-crosshair touch-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          aria-label="Drag a box on the visual to comment on that part"
        >
          {/* The boxes first, then the pins over all of them, so a pin is never under another comment's box. */}
          {comments.map((c) => pins[c.id] && (
            <div key={c.id} className={`absolute border-2 rounded-xs pointer-events-none ${undone(c) ? UNDONE_TONE : STATUS_TONE[c.status]}`} style={pins[c.id]} />
          ))}
          {comments.map((c, n) => {
            const at = spots[c.id];
            if (!at) return null;
            const no = numbers?.[c.id] ?? n + 1;
            const state = commentState(c, undone(c));
            return (
              <div key={c.id} className={`absolute ${openPin === c.id ? "z-30" : "z-20"}`} style={at}>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setOpenPin(openPin === c.id ? null : c.id)}
                  className={`w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center ring-2 ring-paper ${undone(c) ? "bg-paper text-ink-muted border border-line-strong" : "bg-ink text-on-ink"}`}
                  aria-label={`Comment ${no}, ${state.label}: ${c.note}`}
                  aria-expanded={openPin === c.id}
                >
                  {no}
                </button>
                {openPin === c.id && (
                  <div onPointerDown={(e) => e.stopPropagation()} className="absolute left-0 top-full mt-2 w-64 bg-paper border border-hairline rounded-md shadow-[var(--shadow-lg)] p-3 text-left cursor-default">
                    <p className="text-xs text-ink-faint">{no} · {TARGET_LABEL[c.target]} · {state.label}</p>
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
          {live && <div className="absolute border-2 border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" style={live} />}
          {draft && (
            <>
              <div className="absolute border-2 border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]" style={draft.rect} />
              {createPortal(
              <div
                role="dialog"
                aria-label="Change this part"
                onPointerDown={(e) => e.stopPropagation()}
                className="fixed w-[min(300px,calc(100vw-24px))] bg-paper border border-hairline rounded-md shadow-[var(--shadow-lg)] p-3 flex flex-col gap-2.5 cursor-default pop"
                style={{ ...draft.at, zIndex: "var(--z-popover)" }}
              >
                <div className="flex items-center gap-1.5">
                  <MessageSquare size={14} aria-hidden="true" />
                  <p className="text-xs font-medium flex-1">Change this part</p>
                  <BoardIconButton label="Cancel comment" onClick={() => setDraft(null)}><X size={14} aria-hidden="true" /></BoardIconButton>
                </div>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="What the comment is about">
                  {draft.offered.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={draft.target === t}
                      onClick={() => setDraft({ ...draft, target: t })}
                      className={`min-h-8 px-2.5 rounded-full border text-xs ${draft.target === t ? "bg-ink text-on-ink border-ink" : "border-line hover:border-line-strong"}`}
                    >
                      {TARGET_LABEL[t]}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={(el) => el?.focus({ preventScroll: true })}
                  rows={2}
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); if (e.key === "Escape") setDraft(null); }}
                  placeholder={draft.target === "picture" ? "e.g. Put a coffee cup here" : draft.target === "logo" ? "e.g. Make the logo smaller" : "e.g. Shorter and punchier"}
                  className="field text-sm"
                  aria-label="What to change"
                />
                <p className="text-xs text-ink-faint">
                  {TARGET_HINT[draft.target]}
                </p>
                <button type="button" onClick={send} disabled={sending || !note.trim()} className={btnClass("primary", "sm")}>
                  {sending ? <><AgentDots /> Sending…</> : "Send"}
                </button>
              </div>,
              document.body,
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
