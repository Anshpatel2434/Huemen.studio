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
import { AgentDots, IconButton, Menu, MenuItem, MenuSeparator } from "@/components/ui";
import { btnClass } from "@/components/btn";
import type { JobView } from "@/lib/jobs/types";
import type { PictureMode } from "@/lib/visual/design";
import type { VisualComment } from "@/lib/data/visual-comments";

export type Target = VisualComment["target"];
export const TARGET_LABEL: Record<Target, string> = {
  picture: "Picture", headline: "Heading", body: "Body", cta: "Call to action", logo: "Logo", background: "Background",
};
const TARGET_ORDER: Target[] = ["picture", "headline", "body", "cta", "logo", "background"];

// ---- watching queued picture work ------------------------------------------------

export type Watched = { jobId: string; contentItemId: string; artboard: string; label: string; /** The picture before this job, for undo. */ prev?: string | null };

/** Polls each watched job; calls onDone once per job when it stops (succeeded, failed or dead). */
export function useJobWatch(tenantId: string, initial: Watched[], onDone: (w: Watched, job: JobView) => void) {
  const [watching, setWatching] = useState<Watched[]>(initial);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!watching.length) return;
    let stop = false;
    const tick = async () => {
      for (const w of watching) {
        try {
          const res = await fetch(`/w/${tenantId}/jobs/${w.jobId}`, { cache: "no-store" });
          if (!res.ok || stop) continue;
          const job = (await res.json()) as JobView;
          if (job.status === "queued" || job.status === "running") continue;
          setWatching((all) => all.filter((x) => x.jobId !== w.jobId));
          done.current(w, job);
        } catch {
          // Offline for a moment: the next tick tries again.
        }
      }
    };
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [tenantId, watching]);
  const watch = useCallback((w: Watched) => setWatching((all) => [...all.filter((x) => x.jobId !== w.jobId), w]), []);
  return { watching, watch };
}

/** Shown over a visual while its picture is being drawn or changed. */
export function WorkingOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,var(--paper)_70%,transparent)] backdrop-blur-[2px] pointer-events-none">
      <span className="inline-flex items-center gap-2 bg-paper border border-hairline rounded-full px-3 min-h-9 text-sm shadow-[var(--shadow-sm)]"><AgentDots /> {label}</span>
    </div>
  );
}

// ---- the picture menu ---------------------------------------------------------------

export function PictureMenu({ has, mode, hasPrevious, busy, onDraw, onPrevious, onRemove }: {
  has: boolean; mode: PictureMode | null; hasPrevious: boolean; busy: boolean;
  onDraw: (mode: PictureMode) => void; onPrevious: () => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
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
  return (
    <div ref={ref} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <IconButton label={has ? "Picture" : "Add a picture"} onClick={() => setOpen((o) => !o)} disabled={busy} aria-expanded={open}>
        <ImagePlus size={14} />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-72">
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

const STATUS_TONE: Record<VisualComment["status"], string> = {
  open: "border-[var(--accent)]", working: "border-[var(--accent)]", applied: "border-[var(--ok-line)]", failed: "border-[var(--danger-line)]",
};

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
export function CommentSurface({ enabled, comments, frameOf, onSend, onDismiss, children }: {
  enabled: boolean;
  /** Earlier comments on this visual. */
  comments: VisualComment[];
  /** Which frame an element is in (a carousel has several); defaults to the nearest frame. */
  frameOf?: (el: Element) => HTMLElement | null;
  onSend: (draft: { target: Target; box: Box; note: string }) => Promise<boolean>;
  onDismiss: (id: string) => void;
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; frame: HTMLElement } | null>(null);
  const [live, setLive] = useState<Rect | null>(null);
  // `at` is where the panel opens on screen: under the box, or over it when the screen ends first.
  const [draft, setDraft] = useState<(Omit<Draft, "frame"> & { rect: Rect; at: { left: number; top?: number; bottom?: number } }) | null>(null);
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
    setDraft({ box, target, offered: partsIn(s0.frame), rect, at });
    setNote("");
  };

  const send = async () => {
    if (!draft || !note.trim()) return;
    setSending(true);
    const ok = await onSend({ target: draft.target, box: draft.box, note: note.trim() });
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
          {comments.map((c, n) => pins[c.id] && (
            <div key={c.id} className={`absolute border-2 rounded-xs ${STATUS_TONE[c.status]}`} style={pins[c.id]}>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setOpenPin(openPin === c.id ? null : c.id)}
                className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-ink text-on-ink text-xs font-medium flex items-center justify-center"
                aria-label={`Comment ${n + 1}: ${c.note}`}
              >
                {n + 1}
              </button>
              {openPin === c.id && (
                <div onPointerDown={(e) => e.stopPropagation()} className="absolute left-0 top-full mt-2 w-64 z-30 bg-paper border border-hairline rounded-md shadow-[var(--shadow-lg)] p-3 text-left cursor-default">
                  <p className="text-xs text-ink-faint">{TARGET_LABEL[c.target]}</p>
                  <p className="text-sm mt-0.5">{c.note}</p>
                  <p className="text-xs mt-2 text-ink-muted">
                    {c.status === "working" ? <span className="inline-flex items-center gap-1.5"><AgentDots /> Working on it</span> : c.result ?? (c.status === "open" ? "Waiting" : "")}
                  </p>
                  {c.status !== "working" && (
                    <button type="button" onClick={() => { setOpenPin(null); onDismiss(c.id); }} className={`${btnClass("ghost", "sm")} mt-2`}>Clear this comment</button>
                  )}
                </div>
              )}
            </div>
          ))}
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
                  <IconButton label="Cancel comment" onClick={() => setDraft(null)}><X size={14} /></IconButton>
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
                  {draft.target === "picture" ? "Only the marked area of the picture is redrawn." : draft.target === "logo" || draft.target === "background" ? "Changes this visual's design settings." : "Rewrites this text in your voice."}
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
