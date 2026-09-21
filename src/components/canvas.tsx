"use client";

/**
 * Infinite canvas (Relume sitemap/wireframe/design surface): dotted ground,
 * pan (hand tool, space-drag, middle-drag or trackpad scroll), zoom (ctrl/⌘ +
 * wheel, or the zoom menu), fit-to-content, and the floating tool strip.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MousePointer2, Hand, ChevronDown, Monitor, Tablet, Smartphone, GripVertical } from "lucide-react";

export type Device = "desktop" | "tablet" | "mobile";

const ZOOMS = [25, 50, 75, 100, 150];

export function Canvas({
  children, device, onDevice, initialZoom, toolbarExtra, onBackground,
}: {
  children: ReactNode;
  device?: Device;
  onDevice?: (d: Device) => void;
  initialZoom?: number;
  toolbarExtra?: ReactNode;
  /** A plain click on empty canvas (clears the selection). */
  onBackground?: () => void;
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

  const fit = useCallback(() => {
    const w = wrap.current, s = stage.current;
    if (!w || !s) return;
    const sw = s.scrollWidth, sh = s.scrollHeight;
    const z = Math.min(1, (w.clientWidth - 80) / sw, (w.clientHeight - 120) / sh);
    const zz = Math.max(0.2, Math.round(z * 100) / 100);
    setZoom(zz);
    setPan({ x: Math.max(40, (w.clientWidth - sw * zz) / 2), y: 48 });
  }, []);

  useLayoutEffect(() => {
    if (!fitted.current && initialZoom === undefined) {
      fitted.current = true;
      fit();
    }
  }, [fit, initialZoom]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.code === "Space") { setSpace(true); e.preventDefault(); }
      if (e.key === "h") setTool("hand");
      if (e.key === "v") setTool("select");
      if (e.shiftKey && e.key === "!") fit();
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpace(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [fit]);

  useEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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
    if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };

  const zoomTo = (pct: number) => {
    const w = wrap.current;
    if (!w) return setZoom(pct / 100);
    const cx = w.clientWidth / 2, cy = w.clientHeight / 2;
    const nz = pct / 100;
    setPan((p) => ({ x: cx - ((cx - p.x) / zoom) * nz, y: cy - ((cy - p.y) / zoom) * nz }));
    setZoom(nz);
    setMenu(false);
  };

  return (
    <div className="absolute inset-0 overflow-hidden canvas-dots select-none" ref={wrap}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      style={{ cursor: dragging ? "grabbing" : panning ? "grab" : "default" }}
      data-canvas-bg="1"
    >
      <div
        ref={stage}
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, pointerEvents: panning ? "none" : undefined }}
      >
        {children}
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-paper border border-hairline rounded-[12px] p-1 shadow-[var(--shadow)]" onPointerDown={(e) => e.stopPropagation()}>
        <ToolBtn on={tool === "select"} onClick={() => setTool("select")} title="Select (V)"><MousePointer2 size={16} /></ToolBtn>
        <ToolBtn on={tool === "hand"} onClick={() => setTool("hand")} title="Hand (H, or hold Space)"><Hand size={16} /></ToolBtn>
        <span className="w-px h-5 bg-hairline mx-0.5" />
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="h-8 px-2.5 rounded-[8px] flex items-center gap-1 text-[0.82rem] tabular-nums hover:bg-field">
            {Math.round(zoom * 100)}% <ChevronDown size={13} className="text-ink-faint" />
          </button>
          {menu && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-40 bg-paper border border-hairline rounded-[10px] shadow-[var(--shadow-lg)] p-1 pop">
              <button onClick={() => { fit(); setMenu(false); }} className="w-full text-left h-8 px-2.5 rounded-[7px] hover:bg-field text-[0.82rem] flex justify-between">Zoom to fit <span className="text-ink-faint">⇧1</span></button>
              {ZOOMS.map((z) => (
                <button key={z} onClick={() => zoomTo(z)} className="w-full text-left h-8 px-2.5 rounded-[7px] hover:bg-field text-[0.82rem]">{z}%</button>
              ))}
            </div>
          )}
        </div>
        {onDevice && (
          <>
            <span className="w-px h-5 bg-hairline mx-0.5" />
            <ToolBtn on={device === "desktop"} onClick={() => onDevice("desktop")} title="Desktop"><Monitor size={15} /></ToolBtn>
            <ToolBtn on={device === "tablet"} onClick={() => onDevice("tablet")} title="Tablet"><Tablet size={15} /></ToolBtn>
            <ToolBtn on={device === "mobile"} onClick={() => onDevice("mobile")} title="Mobile"><Smartphone size={15} /></ToolBtn>
          </>
        )}
        {toolbarExtra}
      </div>
    </div>
  );
}

export function ToolBtn({ children, on, onClick, title }: { children: ReactNode; on?: boolean; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={on} className={`w-8 h-8 rounded-[8px] flex items-center justify-center transition-colors ${on ? "bg-accent-soft text-accent-ink" : "text-ink-muted hover:bg-field"}`}>
      {children}
    </button>
  );
}

/** Artboard frame label + white board, used on every canvas. */
export function Artboard({ label, meta, width, children, selected, onSelect, actions, onDragStart, onDragEnd, dimmed }: {
  label: string; meta?: string; width: number; children: ReactNode; selected?: boolean; onSelect?: () => void; actions?: ReactNode;
  /** Makes the label bar a drag handle (e.g. move a piece to another pillar). */
  onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; dimmed?: boolean;
}) {
  return (
    <div className={`shrink-0 group/board transition-opacity ${dimmed ? "opacity-40" : ""}`} style={{ width }}>
      <div
        className={`flex items-center gap-2 mb-2 h-6 px-0.5 ${onDragStart ? "cursor-grab active:cursor-grabbing" : ""}`}
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title={onDragStart ? "Drag to move" : undefined}
      >
        {onDragStart && <GripVertical size={13} className="-ml-1 text-ink-faint opacity-0 group-hover/board:opacity-100 shrink-0" />}
        <span className={`text-[0.78rem] font-medium truncate ${selected ? "text-accent-ink" : "text-ink-muted"}`}>{label}</span>
        {meta && <span className="text-[0.72rem] text-ink-faint truncate">{meta}</span>}
        <span className="ml-auto flex items-center gap-1">{actions}</span>
      </div>
      <div
        onClick={onSelect}
        className={`theme-light bg-paper rounded-[4px] overflow-hidden transition-shadow ${onSelect ? "cursor-pointer" : ""} ${selected ? "ring-2 ring-accent" : "ring-1 ring-[var(--hairline)] hover:ring-[var(--line)]"}`}
      >
        {children}
      </div>
    </div>
  );
}
