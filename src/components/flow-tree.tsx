"use client";

/**
 * A connected map drawn top to bottom, with smooth lines (the Ideate map's
 * look, made reusable). Rows of cards; each card registers itself; edges are
 * measured from the cards and drawn as one cubic curve each, bottom-centre to
 * top-centre, so wrapping rows still connect and nothing snaps to a grid.
 * Inked edges are the path that matters and draw themselves in; the rest stay
 * faint. Purely presentational: callers decide what the nodes mean.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Edge = { from: string; to: string; on?: boolean };
const Reg = createContext<(key: string) => (el: HTMLElement | null) => void>(() => () => {});

export function FlowTree({ edges, children, className = "" }: { edges: Edge[]; children: ReactNode; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const at = useCallback((key: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); }, []);
  const [paths, setPaths] = useState<{ id: string; d: string; on: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const key = edges.map((e) => `${e.from}>${e.to}:${e.on ? 1 : 0}`).join("|");

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => {
      const r = box.getBoundingClientRect();
      setPaths(edges.flatMap((e) => {
        const a = nodes.current.get(e.from)?.getBoundingClientRect();
        const b = nodes.current.get(e.to)?.getBoundingClientRect();
        if (!a || !b) return [];
        const x1 = a.left + a.width / 2 - r.left, y1 = a.bottom - r.top;
        const x2 = b.left + b.width / 2 - r.left, y2 = b.top - r.top;
        const bend = Math.max(14, (y2 - y1) * 0.55);
        return [{ id: `${e.from}>${e.to}`, on: !!e.on, d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}` }];
      }));
      setSize({ w: r.width, h: r.height });
    };
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
    // `key` stands for `edges`, which callers rebuild every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <Reg.Provider value={at}>
      <div ref={wrap} className={`relative ${className}`}>
        <svg className="absolute inset-0 pointer-events-none overflow-visible" width={size.w} height={size.h} aria-hidden="true">
          {[...paths].sort((a, b) => Number(a.on) - Number(b.on)).map((p) => (
            <path key={`${p.id}:${p.on}`} d={p.d} pathLength={1} className={p.on ? "hu-tree-line hu-tree-line--on" : "hu-tree-line"} />
          ))}
        </svg>
        {children}
      </div>
    </Reg.Provider>
  );
}

/** One card on the map. `tone`: on (part of the path), dim (not picked), ghost (nothing there yet). */
export function FlowNode({ id, label, icon, children, tone, className = "", width = "w-[200px]" }: {
  id: string; label: ReactNode; icon?: ReactNode; children?: ReactNode;
  tone?: "on" | "dim" | "ghost"; className?: string; width?: string;
}) {
  const at = useContext(Reg);
  return (
    <div
      ref={at(id)}
      className={`relative z-10 ${width} rounded-xl bg-paper border transition-[opacity,border-color] duration-300 ${
        tone === "ghost" ? "border-dashed border-line text-ink-faint" : tone === "on" ? "border-line-strong shadow-[var(--shadow-sm)]" : "border-hairline"
      } ${tone === "dim" ? "opacity-50" : ""} ${className}`}
    >
      <p className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-muted border-b border-hairline">
        {icon}<span className="truncate">{label}</span>
      </p>
      {children && <div className="px-3 py-2.5">{children}</div>}
    </div>
  );
}
