"use client";

/**
 * Infinite canvas (Relume sitemap/wireframe/design surface): dotted ground,
 * pan (hand tool, space-drag, middle-drag or trackpad scroll), zoom (ctrl/⌘ +
 * wheel, or the zoom menu), fit-to-content, and the tool strip, anchored to
 * the bottom centre of the visible canvas.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MousePointer2, Hand, ChevronDown, Monitor, Tablet, Smartphone, GripVertical, Pencil, PanelRight } from "lucide-react";
import { usePanels, useRightToggle } from "@/components/project-panels";
import { PENDING_KEY_MAX_MS, type PendingKey } from "@/lib/ui/pending-key";
import { fitAll, fitOpen, FIT_BOTTOM } from "./canvas-fit";

export type Device = "desktop" | "tablet" | "mobile";

const ZOOMS = [25, 50, 75, 100, 150];

/** One tool a board adds to the strip, beside Select and Hand. */
export type CanvasTool = {
  id: string;
  label: string;
  /** The key that switches it on and off (one letter). */
  key: string;
  icon: ReactNode;
  /** Why it can't be used right now: the tool shows disabled, with this in its tip. */
  off?: string;
};

/**
 * A board's own tools in the strip. One is on at a time (`active`); choosing
 * Select or Hand, pressing V, H or Escape, or the tool's own key again leaves
 * it. `line` is a second row INSIDE the strip, above the buttons: what the
 * tool wants next, its counts and its Send and Close. Nothing floats.
 */
export type CanvasTools = {
  items: CanvasTool[];
  active: string | null;
  onChange: (id: string | null) => void;
  line?: ReactNode;
  /** A tool that is `off` was pressed (a tap has no hover to show the tip): say why. */
  onOff?: (tool: CanvasTool) => void;
};

/** Keys go to whatever is being typed in, and to an open dialog, before any tool. */
const elsewhere = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, [contenteditable], [role='dialog']");
/**
 * A letter typed while a pin, a pin's note or a menu has focus is not a tool
 * key (PI-04): a click on an old pin left focus on it, and typing "make it
 * bold" switched tools letter by letter and ended on Remove background.
 */
const onAPin = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("[data-pin], [role='menu'], [role='menuitem']");
/** A menu or a modal dialog is open: Escape is theirs, not the tool's (PI-05). */
const somethingOpen = () => !!document.querySelector("[role='menu'], [role='dialog'][aria-modal='true']");


export function Canvas({
  children, device, onDevice, initialZoom, toolbarExtra, onBackground, tools,
}: {
  children: ReactNode;
  device?: Device;
  onDevice?: (d: Device) => void;
  initialZoom?: number;
  toolbarExtra?: ReactNode;
  /** A plain click on empty canvas (clears the selection). */
  onBackground?: () => void;
  /** The board's own tools (Comment, Markup and so on), each with a key. */
  tools?: CanvasTools;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(initialZoom ?? 1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [space, setSpace] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fitted = useRef(false);
  // Once a person pans or zooms, the view is theirs: a panel opening beside
  // the canvas no longer refits it.
  const touched = useRef(false);
  const rightToggle = useRightToggle();
  const panels = usePanels();

  // Which fit the view is on, so a panel docking refits the same way.
  const fitMode = useRef<"open" | "all">("open");

  /**
   * Fit to the canvas a person can see. The wrapper IS that area: panels are
   * docked beside it (components/project-panels), never over it. Controls sit
   * in strips along its top and bottom, so fitted content sits between them.
   * The maths is components/canvas-fit (pure, tested):
   *   - "open": the view a board opens on (the first artboard when the whole
   *     stage would be under half size, or on a phone).
   *   - "all": Zoom to fit (menu, Shift+1): the whole stage, whatever its size,
   *     never under 20%. 2026-11-19: it used the opening rule, so on the pillar
   *     map (opened at 100% on its readable frame) it changed nothing.
   */
  const fit = useCallback((mode: "open" | "all" = "open") => {
    const w = wrap.current, s = stage.current;
    if (!w || !s) return;
    touched.current = false;
    fitMode.current = mode;
    // The tool strip wraps to two or three rows on a phone: what it covers beyond the
    // bottom strip the maths allows for is taken off the fitted area, so nothing fitted
    // ends up under it (2026-11-19 QA: "Check for words" sat half under it at 390 px).
    const stripCover = strip.current ? strip.current.offsetHeight + 16 : 0;
    const box = { w: w.clientWidth, h: w.clientHeight - Math.max(0, stripCover - FIT_BOTTOM) };
    const size = { w: s.scrollWidth, h: s.scrollHeight };
    let view;
    if (mode === "all") view = fitAll(box, size);
    else {
      // A board can mark the piece to open on (data-canvas-focus: the one a link
      // such as ?item=<id> names, or the one being worked on): its first
      // artboard is the one fitted, so the view lands on that piece.
      const first = s.querySelector<HTMLElement>("[data-canvas-focus] [data-artboard]") ?? s.querySelector<HTMLElement>("[data-artboard]");
      let board = null;
      if (first) {
        // Where the first artboard sits on the stage, whatever wraps it.
        let x = 0, y = 0;
        for (let el: HTMLElement | null = first; el && el !== s; el = el.offsetParent as HTMLElement | null) { x += el.offsetLeft; y += el.offsetTop; }
        // A note or a button under the artboard in its own column (the words check, the
        // heading check) belongs to it: the fit keeps it in view too.
        const column = first.parentElement;
        const h = column && column !== s && column.firstElementChild === first ? Math.max(first.offsetHeight, column.offsetHeight) : first.offsetHeight;
        board = { x, y, w: first.offsetWidth, h };
      }
      view = fitOpen(box, size, board);
    }
    setZoom(view.zoom);
    setPan(view.pan);
  }, []);

  useLayoutEffect(() => {
    if (!fitted.current && initialZoom === undefined) {
      fitted.current = true;
      fit();
    }
  }, [fit, initialZoom]);

  // A panel docking or leaving changes the visible canvas: fit again, unless
  // the person has already chosen their own view.
  useEffect(() => {
    const w = wrap.current;
    if (!w || initialZoom !== undefined || typeof ResizeObserver === "undefined") return;
    let width = w.clientWidth, height = w.clientHeight;
    const ro = new ResizeObserver(() => {
      if (w.clientWidth === width && w.clientHeight === height) return;
      width = w.clientWidth; height = w.clientHeight;
      if (!touched.current) fit(fitMode.current);
    });
    ro.observe(w);
    return () => ro.disconnect();
  }, [fit, initialZoom]);

  // The tools change every render (a new object); the key handler reads them through a ref.
  const toolsRef = useRef(tools);
  useEffect(() => { toolsRef.current = tools; }, [tools]);

  useEffect(() => {
    /** A plain tool key (one letter, no Ctrl, Cmd or Alt): V, H, or a board tool's own. */
    const letter = (key: string) => {
      const tools = toolsRef.current;
      const k = key.toLowerCase();
      if (k === "h") { setTool("hand"); tools?.onChange(null); }
      if (k === "v") { setTool("select"); tools?.onChange(null); }
      const mine = tools?.items.find((it) => it.key.toLowerCase() === k);
      if (tools && mine && mine.off) tools.onOff?.(mine);
      else if (tools && mine) { setTool("select"); tools.onChange(tools.active === mine.id ? null : mine.id); }
    };
    const down = (e: KeyboardEvent) => {
      const tools = toolsRef.current;
      if (elsewhere(e.target)) return;
      // Space pans, except on a focused control, where it presses that control (a strip button, a slider).
      if (e.code === "Space" && !(e.target as HTMLElement | null)?.closest?.("button, a, [role='slider'], [role='radio'], summary")) { setSpace(true); e.preventDefault(); }
      // A tool's key, and V and H, are plain keys: with Ctrl, Cmd or Alt they are someone else's shortcut.
      // A held key counts once (PI-03: each auto-repeat toggled the tool), and
      // letters typed on a pin or in a menu are not tool keys (PI-04).
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !onAPin(e.target)) letter(e.key);
      // Escape leaves the tool, unless it is closing a menu or a dialog first (PI-05): one thing per press.
      if (e.key === "Escape" && tools?.active && !e.defaultPrevented && !somethingOpen()) tools.onChange(null);
      // Shift+1 (e.code, so it works whatever the layout puts on that key).
      if (e.shiftKey && (e.key === "!" || e.code === "Digit1") && !e.repeat) { e.preventDefault(); fit("all"); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpace(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    // A key pressed before the board was listening (PI-01) is played now, once.
    const w = window as unknown as { __huPendingKey?: PendingKey | null; __huCanvasReady?: number };
    w.__huCanvasReady = 1;
    const pending = w.__huPendingKey;
    w.__huPendingKey = null;
    if (pending && Date.now() - pending.t < PENDING_KEY_MAX_MS && (!pending.p || pending.p === window.location.pathname) && !elsewhere(document.activeElement)) letter(pending.key);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); w.__huCanvasReady = 0; };
  }, [fit]);

  // Escape closes the Zoom menu, like every other menu (2026-11-19: it only
  // closed when an option was picked). Marked handled, so the same press does
  // not also drop the tool in use (PI-05: one thing per press).
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setMenu(false);
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [menu]);

  // Two fingers on a phone or tablet zoom the canvas about their middle (PI-17);
  // one finger still pans or draws as before. Tracked in the capture phase, so
  // the comment and drawing surfaces never see the second finger.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number; px: number; py: number; mx: number; my: number } | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; panRef.current = pan; }, [zoom, pan]);
  const touchDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const rect = wrap.current?.getBoundingClientRect();
      pinch.current = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoomRef.current, px: panRef.current.x, py: panRef.current.y,
        mx: (a.x + b.x) / 2 - (rect?.left ?? 0), my: (a.y + b.y) / 2 - (rect?.top ?? 0),
      };
      // The first finger's pan, stroke or box is dropped: two fingers are a zoom.
      drag.current = null;
      setDragging(false);
      e.stopPropagation();
    }
  };
  const touchMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || !touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (!p || touches.current.size < 2) return;
    e.stopPropagation();
    const [a, b] = [...touches.current.values()];
    const nz = Math.min(2, Math.max(0.2, p.z * (Math.hypot(a.x - b.x, a.y - b.y) / p.d)));
    touched.current = true;
    setZoom(nz);
    setPan({ x: p.mx - ((p.mx - p.px) / p.z) * nz, y: p.my - ((p.my - p.py) / p.z) * nz });
  };
  const touchUp = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  };

  // The tool strip's height, for the toasts to sit above it (PI-15): with a
  // tool's line, or wrapped on a phone, the strip is taller than the space a
  // toast used to leave for it.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const put = () => root.style.setProperty("--hu-toast-lift", `${Math.round(el.offsetHeight + 16 + 12)}px`);
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--hu-toast-lift"); };
  }, []);

  useEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = true;
      if (e.ctrlKey || e.metaKey) {
        const rect = w.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        setZoom((z) => {
          const nz = Math.min(2, Math.max(0.2, z * (1 - e.deltaY * 0.0022)));
          setPan((p) => ({ x: mx - ((mx - p.x) / z) * nz, y: my - ((my - p.y) / z) * nz }));
          return nz;
        });
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    w.addEventListener("wheel", onWheel, { passive: false });
    return () => w.removeEventListener("wheel", onWheel);
  }, []);

  const panning = tool === "hand" || space;

  const onPointerDown = (e: React.PointerEvent) => {
    const onBg = e.target === wrap.current || (e.target as HTMLElement).dataset.canvasBg === "1";
    if (e.button === 0 && onBg && !panning) onBackground?.();
    if (e.button === 1 || panning || (e.button === 0 && onBg)) {
      drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (e.clientX !== d.x || e.clientY !== d.y) touched.current = true;
    setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };

  const zoomTo = (pct: number) => {
    const w = wrap.current;
    touched.current = true;
    if (!w) return setZoom(pct / 100);
    const cx = w.clientWidth / 2, cy = w.clientHeight / 2;
    const nz = pct / 100;
    setPan((p) => ({ x: cx - ((cx - p.x) / zoom) * nz, y: cy - ((cy - p.y) / zoom) * nz }));
    setZoom(nz);
    setMenu(false);
  };

  return (
    <div className="absolute inset-0 overflow-hidden canvas-dots select-none touch-none" ref={wrap}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerDownCapture={touchDown} onPointerMoveCapture={touchMove} onPointerUpCapture={touchUp} onPointerCancelCapture={touchUp}
      // The canvas moves only by pan and zoom. The browser still scrolls a clipped
      // box to show a field that gets focus (2026-11-18: an inline comment field
      // near the edge slid the whole board 112px under the Layers panel), so any
      // such scroll is put straight back.
      onScroll={(e) => { const el = e.currentTarget; if (el.scrollLeft || el.scrollTop) { el.scrollLeft = 0; el.scrollTop = 0; } }}
      style={{
        cursor: dragging ? "grabbing" : panning ? "grab" : "default",
        // The background pattern follows pan and zoom (globals.css, canvas backgrounds).
        ["--cv-x" as string]: `${pan.x}px`, ["--cv-y" as string]: `${pan.y}px`, ["--cv-z" as string]: zoom,
      }}
      data-canvas-bg="1"
    >
      <div
        ref={stage}
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, pointerEvents: panning ? "none" : undefined }}
      >
        {children}
      </div>

      {/* The tool strip: bottom centre of the visible canvas, never over a panel.
          It is as wide as its buttons and no wider than the canvas: on a narrow
          screen the buttons wrap to rows inside it, so the page never scrolls sideways. */}
      <div className="absolute bottom-4 inset-x-3 z-20 flex justify-center pointer-events-none">
        <div ref={strip} className="hu-strip hu-strip--rows pointer-events-auto" onPointerDown={(e) => e.stopPropagation()}>
          {tools?.line && <div className="hu-strip__line">{tools.line}</div>}
          <div className="hu-strip__row">
            <ToolBtn on={tool === "select" && !tools?.active} onClick={() => { setTool("select"); tools?.onChange(null); }} label="Select (V)"><MousePointer2 size={18} /></ToolBtn>
            <ToolBtn on={tool === "hand" && !tools?.active} onClick={() => { setTool("hand"); tools?.onChange(null); }} label="Hand (H, or hold Space)"><Hand size={18} /></ToolBtn>
            {tools && tools.items.length > 0 && (
              <>
                <span className="hu-strip__sep" aria-hidden="true" />
                {tools.items.map((it) => (
                  <ToolBtn
                    key={it.id}
                    on={tools.active === it.id}
                    off={it.off}
                    label={`${it.label} (${it.key.toUpperCase()})`}
                    onClick={() => {
                      if (it.off) return tools.onOff?.(it);
                      setTool("select");
                      tools.onChange(tools.active === it.id ? null : it.id);
                    }}
                  >
                    {it.icon}
                  </ToolBtn>
                ))}
              </>
            )}
            <span className="hu-strip__sep" aria-hidden="true" />
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label={`Zoom, ${Math.round(zoom * 100)}%`} className="min-h-11 px-3 rounded-sm flex items-center gap-1 text-sm font-mono tabular-nums hover:bg-hover">
                {Math.round(zoom * 100)}% <ChevronDown size={15} className="text-ink-faint" aria-hidden="true" />
              </button>
              {menu && (
                <div role="menu" aria-label="Zoom" className="hu-menu absolute bottom-14 left-1/2 -translate-x-1/2 !min-w-44 pop">
                  <button type="button" role="menuitem" onClick={() => { fit("all"); setMenu(false); }} className="hu-menu__item"><span className="flex-1">Zoom to fit</span> <span className="text-ink-faint font-mono text-xs">⇧1</span></button>
                  {ZOOMS.map((z) => (
                    <button key={z} type="button" role="menuitemradio" aria-checked={Math.round(zoom * 100) === z} onClick={() => zoomTo(z)} className="hu-menu__item font-mono tabular-nums">{z}%</button>
                  ))}
                </div>
              )}
            </div>
            {onDevice && (
              <>
                <span className="hu-strip__sep" aria-hidden="true" />
                <ToolBtn on={device === "desktop"} onClick={() => onDevice("desktop")} label="Desktop"><Monitor size={17} /></ToolBtn>
                <ToolBtn on={device === "tablet"} onClick={() => onDevice("tablet")} label="Tablet"><Tablet size={17} /></ToolBtn>
                <ToolBtn on={device === "mobile"} onClick={() => onDevice("mobile")} label="Mobile"><Smartphone size={17} /></ToolBtn>
              </>
            )}
            {toolbarExtra}
            {/* Outside the project editor (the pillar map) the panel's switch is a tool like any other. */}
            {rightToggle && panels?.toggleIn === "strip" && (
              <>
                <span className="hu-strip__sep" aria-hidden="true" />
                <ToolBtn on={rightToggle.shown} onClick={rightToggle.toggle} label={`${rightToggle.label} panel`}><PanelRight size={17} /></ToolBtn>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A button in the tool strip: an icon named by aria-label, with the app's own
 * tip on hover and keyboard focus (data-tip, components.css; a native tooltip
 * is system UI). `off` is why it can't be used now: it stays focusable so the
 * reason can be read, looks disabled, and says the reason in its tip.
 */
export function ToolBtn({ children, on, onClick, label, off }: { children?: ReactNode; on?: boolean; onClick: () => void; label: string; off?: string }) {
  const name = off ? `${label}. ${off}` : label;
  return (
    <button
      type="button"
      onClick={onClick}
      data-tip={name}
      aria-label={name}
      aria-pressed={on}
      aria-disabled={off ? true : undefined}
      className={`hu-iconbtn !rounded-sm ${on ? "!bg-accent-soft !text-accent-ink" : ""} ${off ? "opacity-45 !cursor-not-allowed hover:!bg-transparent" : ""}`}
    >
      {children}
    </button>
  );
}

/** Artboard frame label + white board, used on every canvas. */
export function Artboard({ label, meta, width, children, selected, onSelect, onEdit, actions, onDragStart, onDragEnd, dimmed, spill }: {
  label: string; meta?: string; width: number; children: ReactNode; selected?: boolean; onSelect?: () => void; actions?: ReactNode;
  /**
   * Let what is pinned on the board reach past its edge (a comment's field, a
   * pin's note). The board otherwise clips to its corners.
   */
  spill?: boolean;
  /**
   * A plain, visible way in (design system: conventional patterns, nothing to
   * discover): opens the piece's editor, the same as clicking the board.
   */
  onEdit?: () => void;
  /** Makes the label bar a drag handle (e.g. move a piece to another pillar). */
  onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; dimmed?: boolean;
}) {
  return (
    // data-artboard lets the canvas fit one board on a narrow screen without
    // guessing at the wrapper depth around it.
    <div data-artboard className={`shrink-0 group/board transition-opacity ${dimmed ? "opacity-40" : ""}`} style={{ width }}>
      <div
        className={`flex items-center gap-2 mb-2 min-h-6 px-0.5 ${onDragStart ? "cursor-grab active:cursor-grabbing" : ""}`}
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        aria-description={onDragStart ? "Drag to move" : undefined}
      >
        {onDragStart && <GripVertical size={13} className="-ml-1 text-ink-faint opacity-0 group-hover/board:opacity-100 shrink-0" />}
        {/* The name, and the size under it: one shared row cut both off ("Statem... 4:5 · 1080x1...", PI-14). */}
        <span className="min-w-0 flex flex-col leading-tight">
          <span className={`text-xs font-medium truncate ${selected ? "text-accent-ink" : "text-ink-muted"}`}>{label}</span>
          {meta && <span className="text-[0.6875rem] text-ink-faint truncate">{meta}</span>}
        </span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {actions}
          {onEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`ml-1 inline-flex items-center gap-1 h-6 px-2 rounded-full border text-xs font-medium transition-colors ${selected ? "bg-ink text-on-ink border-ink" : "bg-paper border-line text-ink hover:border-line-strong"}`}
            >
              <Pencil size={11} aria-hidden="true" /> Edit
            </button>
          )}
        </span>
      </div>
      <div
        onClick={onSelect}
        className={`theme-light bg-paper rounded-xs ${spill ? "" : "overflow-hidden"} transition-shadow ${onSelect ? "cursor-pointer" : ""} ${selected ? "ring-2 ring-accent" : "ring-1 ring-[var(--hairline)] hover:ring-[var(--line)]"}`}
      >
        {children}
      </div>
    </div>
  );
}
