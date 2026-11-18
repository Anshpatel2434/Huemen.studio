"use client";

/**
 * The picture tools on the Visual board, beside Comment (visual-comments-ui):
 *
 *   ToolLine        what the tool in use wants next, what is waiting, and its
 *                   Send and Close. It is the second row INSIDE the canvas
 *                   tool strip (components/canvas `tools.line`): nothing floats.
 *   PictureSurface  wraps one visual and lays the picture tools over its
 *                   picture, exactly over the part of it the layout shows:
 *                     Markup   a pen; the marks are an instruction (a circle,
 *                              an arrow) with a note beside them
 *                     Erase    a brush; what is brushed over is removed
 *                     Remove background, Resize
 *                              the picture is the button
 *                   Strokes are kept as shares of the PICTURE (not the frame),
 *                   which is what the image model works on.
 *   ResizeModal     a new shape for the picture: drag to place it, zoom, and
 *                   it says plainly whether that is a crop (free) or an
 *                   extension (one picture) before anything is spent.
 *
 * Huemen components only: no browser dialogs, selects, range inputs or
 * native tooltips. Colours come from the theme's tokens.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { AgentDots, Modal } from "@/components/ui";
import { btnClass } from "@/components/btn";
import type { Box } from "@/lib/visual/region-types";
import { BRUSH_WIDTH, PEN_WIDTH, type ResizeInput, type Stroke } from "@/lib/visual/picture-tools";
import { placePins } from "@/lib/visual/pins";
import { RangeSlider } from "./visual-panels";
import { DraftDot, DraftField, pictureOnScreen, picturePoint, type DraftOps, type DraftPin } from "./visual-comments-ui";
import {
  RESIZE_SHAPES, RESIZE_ZOOM, addPoint, clampRatio, overlap, placeAt, rectOfBox, resizeOutcome, simplifyStroke, snapZoom, startZoom, strokePath, widestGap,
  type Point, type Rect, type ResizeOutcome, type ShapeKey,
} from "./picture-tools-maths";

export type PictureTool = "comment" | "markup" | "erase" | "cutout" | "resize";

// ---- the tool's line in the strip -------------------------------------------------------

export function ToolLine({ text, summary, actions = [], send, onClose, closeLabel }: {
  /** What the tool wants next, e.g. "Click a part to add a comment". */
  text: string;
  /** What is waiting to be sent, e.g. "3 changes · uses 2 pictures". */
  summary?: string;
  /** The tool's own extras (Undo stroke, Clear). */
  actions?: { label: string; run: () => void; disabled?: boolean }[];
  /** Send, when there is something to send. Not `ready` until every change that needs words has them. */
  send?: { ready: boolean; busy: boolean; run: () => void } | null;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <>
      <p role="status" className="flex-1 min-w-[11rem] leading-snug">
        {text}
        {summary && <span className="block text-xs text-ink-muted">{summary}</span>}
      </p>
      <span className="flex flex-wrap items-center justify-end gap-1 ml-auto">
        {actions.map((a) => (
          <button key={a.label} type="button" onClick={a.run} disabled={a.disabled} className="hu-strip__btn">{a.label}</button>
        ))}
        {send && (
          <button type="button" onClick={send.run} disabled={!send.ready || send.busy} className="hu-strip__btn hu-strip__btn--primary">
            {send.busy ? <><AgentDots /> Sending…</> : "Send"}
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={closeLabel} data-tip={closeLabel} className="hu-iconbtn !rounded-sm">
          <X size={18} aria-hidden="true" />
        </button>
      </span>
    </>
  );
}

// ---- where the picture is, inside one visual --------------------------------------------

type Geometry = {
  /** The frame the picture is on, the whole picture, and the part of it the layout shows: in the surface's own (unzoomed) pixels. */
  frame: Rect; full: Rect; seen: Rect;
  /** The surface's own height (a field low on it opens upwards). */
  height: number;
  natural: { w: number; h: number };
  /** The slot the layout gives the picture, width over height. */
  slot: number;
  /** Which of the visual's frames it is (a carousel's cover is the first). */
  frameIndex: number;
  /** The whole picture on its frame, in shares of the frame. */
  pic: Box;
};

/** Measured after layout, when the visual resizes and when the picture loads; never during render. */
function usePictureGeometry(wrap: RefObject<HTMLDivElement | null>, on: boolean, pictureKey: string | undefined): Geometry | null {
  const [geo, setGeo] = useState<Geometry | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!on || !el) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const p = pictureOnScreen(el);
        const frame = p?.img.closest<HTMLElement>("[data-part='background']");
        if (!p || !frame) return setGeo(null);
        const w = el.getBoundingClientRect();
        const z = w.width / (el.offsetWidth || w.width) || 1;
        const local = (r: Rect): Rect => ({ left: (r.left - w.left) / z, top: (r.top - w.top) / z, width: r.width / z, height: r.height / z });
        const fr = frame.getBoundingClientRect();
        const frameRect = local({ left: fr.left, top: fr.top, width: fr.width, height: fr.height });
        const full = local(p.full);
        const slot = local(p.slot);
        if (!(frameRect.width > 0) || !(frameRect.height > 0) || !(slot.height > 0)) return setGeo(null);
        setGeo({
          frame: frameRect, full, seen: overlap(full, slot) ?? slot, height: el.offsetHeight, natural: p.natural, slot: slot.width / slot.height,
          frameIndex: Math.max(0, [...el.querySelectorAll("[data-part='background']")].indexOf(frame)),
          pic: { x: (full.left - frameRect.left) / frameRect.width, y: (full.top - frameRect.top) / frameRect.height, w: full.width / frameRect.width, h: full.height / frameRect.height },
        });
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const img = el.querySelector("img[data-part='picture']");
    img?.addEventListener("load", measure);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); img?.removeEventListener("load", measure); };
  }, [wrap, on, pictureKey]);
  return on ? geo : null;
}

// ---- the tools over one visual's picture ------------------------------------------------

/** What a picture click in Remove background or Resize hands back: the picture's own size and its slot's shape. */
export type Picked = { natural: { w: number; h: number }; slot: number };

export function PictureSurface({ tool, pictureKey, lock, drafts, numbers, openDraft, onStroke, onDraft, onPick, onRefuse, children }: {
  /** The tool in use on the board, if any. */
  tool: PictureTool | null;
  /** The picture on this visual (its version id); undefined when it has none. */
  pictureKey: string | undefined;
  /** Why the tool in use can't change this picture right now, when it can't. */
  lock: string | null;
  /** This visual's markup and erase changes that are not sent yet. */
  drafts: DraftPin[];
  numbers: Record<string, number>;
  openDraft: string | null;
  /** A finished stroke. False when it wasn't taken (a limit). */
  onStroke: (kind: "markup" | "erase", stroke: Stroke, on: { frame: number; pic: Box; aspect: number }) => boolean;
  onDraft: Pick<DraftOps, "update" | "remove" | "open">;
  /** The picture was clicked in Remove background or Resize. */
  onPick: (m: Picked) => void;
  onRefuse: (why: string) => void;
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const drawing = tool === "markup" || tool === "erase";
  const marks = drawing || (tool === "comment" && drafts.length > 0);
  const geo = usePictureGeometry(wrap, !!tool && !!pictureKey && (marks || tool === "cutout" || tool === "resize"), pictureKey);
  // The stroke being drawn: in a ref for the pointer handlers, in state to show it.
  const stroke = useRef<Point[] | null>(null);
  const [live, setLive] = useState<Point[] | null>(null);

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || !drawing || !wrap.current) return;
    if (lock) return onRefuse(lock);
    const p = picturePoint(wrap.current, e.clientX, e.clientY);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = [p];
    setLive([p]);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const pts = stroke.current;
    if (!pts || !wrap.current) return;
    const p = picturePoint(wrap.current, e.clientX, e.clientY);
    const next = p ? addPoint(pts, p) : pts;
    if (next !== pts) { stroke.current = next; setLive(next); }
  };
  const up = () => {
    const pts = stroke.current;
    stroke.current = null;
    setLive(null);
    if (!pts || !geo || (tool !== "markup" && tool !== "erase")) return;
    const clean = simplifyStroke(pts);
    if (clean.length) onStroke(tool, { w: tool === "erase" ? BRUSH_WIDTH : PEN_WIDTH, pts: clean }, { frame: geo.frameIndex, pic: geo.pic, aspect: geo.natural.w / geo.natural.h });
  };

  const erased = drafts.filter((d) => d.kind === "erase").flatMap((d) => d.strokes ?? []);
  const marked = drafts.filter((d) => d.kind === "markup").flatMap((d) => d.strokes ?? []);
  const opened = tool === "markup" && geo ? drafts.find((d) => d.id === openDraft && d.kind === "markup") : undefined;
  const boxes = geo ? drafts.map((d) => ({ d, rect: rectOfBox(geo.frame, d.box) })) : [];
  const spots = placePins(boxes.map(({ d, rect }) => ({ id: d.id, left: rect.left, top: rect.top })));

  return (
    <div ref={wrap} className="relative">
      {children}
      {geo && marks && (
        // Over this visual and nothing else. Only the drawing surface takes the pointer, and only in Markup or Erase.
        <div className={`absolute inset-0 pointer-events-none ${opened ? "z-30" : "z-20"}`}>
          <div className="absolute overflow-hidden" style={geo.seen}>
            {(() => {
              const W = geo.full.width, H = geo.full.height;
              const short = Math.min(W, H);
              const line = (s: Stroke, n: number | string) => <path key={n} d={strokePath(s.pts, W, H)} strokeWidth={Math.max(1.5, s.w * short)} />;
              const now: Stroke | null = live && drawing ? { w: tool === "erase" ? BRUSH_WIDTH : PEN_WIDTH, pts: live } : null;
              return (
                <svg
                  // The whole picture, so a point on it is a share of the picture; the box around it shows only what the layout shows.
                  className={`absolute ${drawing ? `pointer-events-auto touch-none ${lock ? "cursor-not-allowed" : "cursor-crosshair"}` : ""}`}
                  style={{ left: geo.full.left - geo.seen.left, top: geo.full.top - geo.seen.top, width: W, height: H }}
                  viewBox={`0 0 ${W} ${H}`}
                  role="img"
                  aria-label={tool === "erase" ? "Brush over what to remove from the picture" : tool === "markup" ? "Draw on the picture to mark what to change" : "Marks on the picture, not sent yet"}
                  onPointerDown={drawing ? down : undefined}
                  onPointerMove={drawing ? move : undefined}
                  onPointerUp={drawing ? up : undefined}
                  onPointerCancel={drawing ? up : undefined}
                >
                  <rect width={W} height={H} fill="transparent" />
                  {/* Erase: a translucent wash in the accent colour. One group, so strokes that cross don't darken. */}
                  <g fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--accent)", opacity: 0.38 }}>
                    {erased.map(line)}
                    {now && tool === "erase" && line(now, "live")}
                  </g>
                  {/* Markup: a pen in the accent colour, on a hair of paper so it reads on any picture. */}
                  <g fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--paper)", opacity: 0.85 }}>
                    {marked.map((s, n) => <path key={n} d={strokePath(s.pts, W, H)} strokeWidth={Math.max(1.5, s.w * short) + 2.5} />)}
                    {now && tool === "markup" && <path d={strokePath(now.pts, W, H)} strokeWidth={Math.max(1.5, now.w * short) + 2.5} />}
                  </g>
                  <g fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--accent)" }}>
                    {marked.map(line)}
                    {now && tool === "markup" && line(now, "live")}
                  </g>
                </svg>
              );
            })()}
          </div>
          {boxes.map(({ d }) => spots[d.id] && (
            <DraftDot
              key={d.id}
              no={numbers[d.id] ?? 0}
              at={spots[d.id]}
              // An erase needs no words, so its pin never asks for any.
              note={d.kind === "erase" ? "erase" : d.note}
              open={d.id === opened?.id}
              onOpen={tool === "markup" && d.kind === "markup" ? () => onDraft.open(d.id === openDraft ? null : d.id) : undefined}
            />
          ))}
          {opened && (() => {
            const rect = rectOfBox(geo.frame, opened.box);
            return (
              <DraftField
                key={opened.id}
                rect={rect}
                flip={geo.height > 0 && rect.top + rect.height / 2 > geo.height * 0.55}
                label={`Markup, change ${numbers[opened.id] ?? ""}`}
                note={opened.note}
                onNote={(v) => onDraft.update(opened.id, { note: v })}
                placeholder="Say what to change here..."
                hint="Only the marked part is redrawn, and the marks are not kept. Uses 1 picture."
                onEnter={() => { if (opened.note.trim()) onDraft.open(null); }}
                onEscape={() => onDraft.open(null)}
                onRemove={() => onDraft.remove(opened.id)}
                removeLabel="Remove these marks"
              />
            );
          })()}
        </div>
      )}
      {geo && (tool === "cutout" || tool === "resize") && (
        // The picture is the button: every picture on the board shows where a click lands.
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          // The click is the tool's, not the visual's: let through, it opened the
          // piece (a new address) and that wiped what the tool had just started
          // (2026-11-18: the first click after the piece was closed did nothing).
          onClick={(e) => { e.stopPropagation(); if (lock) onRefuse(lock); else onPick({ natural: geo.natural, slot: geo.slot }); }}
          aria-label={tool === "cutout" ? "Remove this picture's background" : "Resize this picture"}
          className={`absolute z-20 rounded-xs outline outline-2 outline-dashed -outline-offset-2 outline-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] ${lock ? "cursor-not-allowed" : "cursor-pointer"}`}
          style={geo.seen}
        />
      )}
      {tool && tool !== "comment" && !pictureKey && (
        // A visual with no picture, while a picture tool is in use: a click says so instead of doing something else.
        <div
          className="absolute inset-0 z-20 cursor-not-allowed"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRefuse("This visual has no picture. Add one from the picture button above it."); }}
        />
      )}
    </div>
  );
}

// ---- resize -----------------------------------------------------------------------------

/** The preview's height at its tallest, in pixels. */
const PREVIEW_H = 280;
/** The bare part of the new frame: a soft tint with a fine hatch, in the theme's accent. */
const HATCH = "repeating-linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, transparent) 0 1px, transparent 1px 9px)";
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

const OUTCOME: Record<ResizeOutcome, string> = {
  same: "The picture already has this shape. Move it, zoom it or pick another shape.",
  crop: "Crop. Free, done at once.",
  extend: "The uncovered part is drawn to match. Uses 1 picture.",
  too_little: "Too little of the picture is left. Draw a new picture in this shape instead.",
};

/**
 * Resize one picture. Pick a shape, drag the picture to place it, zoom from
 * "the whole picture inside the frame" to three times that. Where the picture
 * covers the frame it is a crop; where it doesn't, the bare part (hatched,
 * "Drawn to match") is drawn by the image model. It says which, and what it
 * costs, before Apply.
 */
export function ResizeModal({ url, natural, fit, onClose, onApply }: {
  url: string;
  /** The picture's own size in pixels. */
  natural: { w: number; h: number };
  /** The shape of the slot this visual's layout gives the picture (width over height): "Fit this visual". */
  fit: number;
  onClose: () => void;
  /** True when it went through (the board closes the modal); false keeps it open with everything as it was. */
  onApply: (input: ResizeInput) => Promise<boolean>;
}) {
  const aspect = natural.w > 0 && natural.h > 0 ? natural.w / natural.h : 1;
  const ratioOf = (k: ShapeKey) => clampRatio(RESIZE_SHAPES.find((s) => s.key === k)?.ratio ?? fit);
  const [shape, setShape] = useState<ShapeKey>("fit");
  const ratio = ratioOf(shape);
  // Zoom in percent, and where the picture's centre is in the frame.
  const [view, setView] = useState(() => ({ zoom: startZoom(clampRatio(fit), aspect), cx: 0.5, cy: 0.5 }));
  const [busy, setBusy] = useState(false);
  const place = placeAt(ratio, aspect, view.zoom, view.cx, view.cy);
  const outcome = resizeOutcome(place);
  const gap = outcome === "extend" || outcome === "too_little" ? widestGap(place) : null;
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; w: number; h: number } | null>(null);

  const pick = (k: ShapeKey) => {
    setShape(k);
    setView({ zoom: startZoom(ratioOf(k), aspect), cx: 0.5, cy: 0.5 });
  };
  /** Move the picture's centre, never further than its edge allows. */
  const centre = (cx: number, cy: number) => {
    const p = placeAt(ratio, aspect, view.zoom, cx, cy);
    setView((v) => ({ ...v, cx: p.x + p.w / 2, cy: p.y + p.h / 2 }));
  };
  const zoomTo = (zoom: number) => {
    // Zoom about the picture's centre as it is placed now.
    setView({ zoom, cx: place.x + place.w / 2, cy: place.y + place.h / 2 });
  };
  const apply = async () => {
    if (busy || outcome === "same" || outcome === "too_little") return;
    setBusy(true);
    try {
      await onApply({ ratio: round4(ratio), place: { x: round4(place.x), y: round4(place.y), w: round4(place.w), h: round4(place.h) } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Resize the picture"
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnClass("ghost", "sm")}>Cancel</button>
          <button type="button" onClick={() => void apply()} disabled={busy || outcome === "same" || outcome === "too_little"} className={btnClass("primary", "sm")}>
            {busy ? <><AgentDots /> Applying…</> : outcome === "extend" ? "Apply, uses 1 picture" : "Apply"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium mb-1.5">Shape</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Shape">
            {RESIZE_SHAPES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={shape === s.key}
                onClick={() => pick(s.key)}
                className={`min-h-11 px-3.5 rounded-full border text-sm ${shape === s.key ? "bg-ink text-on-ink border-ink" : "border-line hover:border-line-strong"}`}
              >
                {s.label}{s.note && <span className={`ml-1.5 text-xs ${shape === s.key ? "opacity-70" : "text-ink-faint"}`}>{s.note}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-center">
          <div
            role="group"
            tabIndex={0}
            aria-label="The picture in its new shape. Drag it to move it, or use the arrow keys."
            className="relative overflow-hidden rounded-xs border border-line touch-none select-none cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-ink"
            style={{ aspectRatio: String(ratio), width: `min(100%, ${Math.round(PREVIEW_H * ratio)}px)`, backgroundColor: "var(--accent-soft)", backgroundImage: HATCH }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const r = e.currentTarget.getBoundingClientRect();
              drag.current = { x: e.clientX, y: e.clientY, cx: place.x + place.w / 2, cy: place.y + place.h / 2, w: r.width, h: r.height };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d && d.w > 0 && d.h > 0) centre(d.cx + (e.clientX - d.x) / d.w, d.cy + (e.clientY - d.y) / d.h);
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02;
              const by = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
              if (!by) return;
              e.preventDefault();
              e.stopPropagation();
              centre(place.x + place.w / 2 + by[0], place.y + place.h / 2 + by[1]);
            }}
          >
            {gap && gap.size >= 0.08 && (
              // In the widest bare band: what will be there.
              <span
                aria-hidden="true"
                className="absolute flex items-center justify-center overflow-hidden label-mono text-accent-ink"
                style={{
                  ...(gap.side === "left" ? { left: 0, top: 0, bottom: 0, width: pct(gap.size) }
                    : gap.side === "right" ? { right: 0, top: 0, bottom: 0, width: pct(gap.size) }
                      : gap.side === "top" ? { left: 0, right: 0, top: 0, height: pct(gap.size) }
                        : { left: 0, right: 0, bottom: 0, height: pct(gap.size) }),
                  writingMode: gap.side === "left" || gap.side === "right" ? "vertical-rl" : undefined,
                }}
              >
                <span className="whitespace-nowrap">Drawn to match</span>
              </span>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" draggable={false} className="absolute max-w-none pointer-events-none" style={{ left: pct(place.x), top: pct(place.y), width: pct(place.w), height: pct(place.h) }} />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-xs font-medium">Zoom</p>
            <span className="text-xs num text-ink-muted">{Math.round(view.zoom)}%</span>
          </div>
          <RangeSlider
            label="Zoom"
            value={view.zoom}
            range={RESIZE_ZOOM}
            valueText={`${Math.round(view.zoom)}%`}
            snap={(v) => snapZoom(v, ratio, aspect)}
            onChange={zoomTo}
          />
          <p className="text-xs text-ink-faint">Drag the picture to move it. At 100% the whole picture is inside the frame.</p>
        </div>

        <p role="status" className={`text-sm ${outcome === "too_little" ? "text-danger" : outcome === "same" ? "text-ink-muted" : "text-ink"}`}>
          {OUTCOME[outcome]}
        </p>
      </div>
    </Modal>
  );
}
