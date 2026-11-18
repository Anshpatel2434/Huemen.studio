"use client";

/**
 * Docked panels of a canvas page (the project editor, the pillar map).
 *
 * The canvas always keeps a clear working area: a panel takes its own column
 * and the canvas is the space beside it, so fit and zoom work on what a
 * person can actually see. The rules, in one place:
 *
 *   - One panel on the left, one on the right, at most.
 *   - The right slot holds the page's own panel ("Details", "Design"). A post
 *     editor opens IN that slot and replaces it while it is open.
 *   - Below 1200px only one side is open at a time (the shell closes the
 *     other). Below 900px a panel is a sheet over the canvas with a close
 *     button; on a phone it comes up from the bottom.
 *
 * The look is `.hu-dock` / `.hu-panel` in app/components.css.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { PanelRight, X } from "lucide-react";
import { IconButton } from "@/components/ui";

interface EditHandle { close: () => void }

interface Panels {
  /** null: the breakpoint decides (open from 900px, shut below). */
  rightOpen: boolean | null;
  setRight: (open: boolean) => void;
  /** Back to what the breakpoint decides (a page change, a resize across a breakpoint). */
  resetRight: () => void;
  /** The page's right panel by name, or null when the page has none. */
  rightLabel: string | null;
  registerRight: (label: string) => () => void;
  /** The post editor, while one is open in the right slot. */
  edit: EditHandle | null;
  registerEdit: (handle: EditHandle) => () => void;
  /** Where the open/close control lives: the editor's top bar, or the canvas tool strip. */
  toggleIn: "header" | "strip";
}

const PanelsContext = createContext<Panels | null>(null);

/**
 * One page's right slot as an element, so its editor can be rendered into it.
 * Kept per page (per <Stage>), not in the shell: the router can hold a page
 * that is no longer showing, and its slot must never be mistaken for this one.
 */
const DockContext = createContext<{ dock: HTMLElement | null; setDock: (el: HTMLElement | null) => void } | null>(null);

/** True from `px` wide. False on the server and until the browser has been asked. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback((notify: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", notify);
    return () => mq.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/**
 * The state behind one page's panels. `onOpen` runs when the right side is
 * opened on purpose (the control, or an editor), so the owner of the left
 * panel can shut it on a narrow window.
 */
export function usePanelsState(toggleIn: Panels["toggleIn"], onOpen?: () => void): Panels {
  const [rightOpen, setRightOpen] = useState<boolean | null>(null);
  // Held as an object so a page that is leaving only ever clears its own entry.
  const [right, setRightPanel] = useState<{ label: string } | null>(null);
  const [edit, setEdit] = useState<EditHandle | null>(null);
  const opened = useRef(onOpen);
  useEffect(() => { opened.current = onOpen; }, [onOpen]);

  const setRight = useCallback((open: boolean) => {
    setRightOpen(open);
    if (open) opened.current?.();
  }, []);
  const resetRight = useCallback(() => setRightOpen(null), []);
  // Crossing a breakpoint goes back to that width's default, so a panel opened
  // on a wide window is never left as a sheet over a narrow canvas.
  useEffect(() => {
    const queries = [window.matchMedia("(min-width: 1200px)"), window.matchMedia("(min-width: 900px)"), window.matchMedia("(min-width: 640px)")];
    queries.forEach((q) => q.addEventListener("change", resetRight));
    return () => queries.forEach((q) => q.removeEventListener("change", resetRight));
  }, [resetRight]);
  const registerRight = useCallback((label: string) => {
    const mine = { label };
    setRightPanel(mine);
    return () => setRightPanel((cur) => (cur === mine ? null : cur));
  }, []);
  const rightLabel = right?.label ?? null;
  // Below 900px the post editor and the step panel share one sheet in the right
  // slot. Opening the editor shuts the step panel, and closing the editor leaves
  // it shut (the header control or the step's own close brings it back). From
  // 900px the step panel is simply hidden while an editor is open, as before.
  const registerEdit = useCallback((handle: EditHandle) => {
    setEdit(handle);
    opened.current?.();
    const narrow = () => !window.matchMedia("(min-width: 900px)").matches;
    if (narrow()) setRightOpen(false);
    return () => {
      setEdit((cur) => (cur === handle ? null : cur));
      if (narrow()) setRightOpen(false);
    };
  }, []);

  return useMemo(
    () => ({ rightOpen, setRight, resetRight, rightLabel, registerRight, edit, registerEdit, toggleIn }),
    [rightOpen, setRight, resetRight, rightLabel, registerRight, edit, registerEdit, toggleIn],
  );
}

export function PanelsProvider({ value, children }: { value: Panels; children: ReactNode }) {
  return <PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>;
}

export const usePanels = () => useContext(PanelsContext);

/**
 * The right slot. From 900px it is a column beside the canvas; below that a
 * sheet over it. Holds the page's panel, and the editor when one is open.
 */
export function RightDock({ label, children }: { label: string; children: ReactNode }) {
  const panels = usePanels();
  const slot = useContext(DockContext);
  const register = panels?.registerRight;
  useEffect(() => register?.(label), [register, label]);
  const open = panels?.rightOpen ?? null;
  return (
    <div ref={slot?.setDock} className="hu-dock" data-open={open === null ? "auto" : String(open)}>
      {children}
    </div>
  );
}

/**
 * A canvas page: a row of the working area (<StageCanvas>) and, after it, the
 * panel docked on the right (<RightDock>, or a <StepPanel>, which brings its
 * own). Inside the project editor the shell owns the panels; anywhere else
 * (the pillar map) the page keeps its own, with the control in the canvas
 * tool strip.
 */
export function Stage({ children }: { children: ReactNode }) {
  const outer = usePanels();
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const slot = useMemo(() => ({ dock, setDock }), [dock]);
  const body = (
    <DockContext.Provider value={slot}>
      <div className="absolute inset-0 flex overflow-hidden">{children}</div>
    </DockContext.Provider>
  );
  return outer ? body : <OwnPanels>{body}</OwnPanels>;
}

/** The working area of a <Stage>: whatever is left beside the docked panel. */
export function StageCanvas({ children }: { children: ReactNode }) {
  return <div className="relative flex-1 min-w-0">{children}</div>;
}

function OwnPanels({ children }: { children: ReactNode }) {
  const panels = usePanelsState("strip");
  return <PanelsProvider value={panels}>{children}</PanelsProvider>;
}

/** The page's own panel in the right slot. Hidden (not unmounted) while an editor is open. */
export function DockPanel({ label, title, closeLabel = "Close panel", children }: {
  /** Accessible name of the panel. */
  label: string;
  /** The header line. */
  title: ReactNode;
  closeLabel?: string;
  children: ReactNode;
}) {
  const panels = usePanels();
  return (
    <aside aria-label={label} data-panel="step" className="hu-panel">
      <div className="min-h-12 shrink-0 flex items-center pl-5 pr-1.5 border-b border-hairline">
        <span className="label-mono text-ink-faint flex-1 truncate">{title}</span>
        <IconButton label={closeLabel} onClick={() => panels?.setRight(false)}><X size={17} /></IconButton>
      </div>
      {children}
    </aside>
  );
}

/**
 * A post editor in the right slot. It replaces the page's panel while it is
 * open, and shuts the left panel on a narrow window (through the shell).
 */
export function EditPanel({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panels = usePanels();
  const slot = useContext(DockContext);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const register = panels?.registerEdit;
  useEffect(() => register?.({ close: () => close.current() }), [register]);
  const panel = <aside aria-label={label} data-panel="edit" className="hu-panel fade-in">{children}</aside>;
  // Outside a <Stage> there is no slot: fall back to a sheet on the right edge.
  if (!slot) return <div className="hu-dock" data-open="true">{panel}</div>;
  return slot.dock ? createPortal(panel, slot.dock) : null;
}

/** What the open/close control needs: the panel's name, whether it shows, and the switch. */
export function useRightToggle(): { label: string; shown: boolean; toggle: () => void } | null {
  const panels = usePanels();
  const wide = useMinWidth(900);
  if (!panels || (!panels.rightLabel && !panels.edit)) return null;
  const shown = !!panels.edit || (panels.rightOpen ?? wide);
  return {
    label: panels.rightLabel ?? "Details",
    shown,
    toggle: () => {
      if (panels.edit) return panels.edit.close();
      panels.setRight(!shown);
    },
  };
}

/** The control in the editor's top bar: shows or hides the right panel. */
export function RightPanelToggle({ className = "" }: { className?: string }) {
  const panels = usePanels();
  const t = useRightToggle();
  if (!t || panels?.toggleIn !== "header") return null;
  const name = `${t.shown ? "Hide" : "Show"} ${t.label.toLowerCase()} panel`;
  return (
    <button type="button" onClick={t.toggle} aria-pressed={t.shown} aria-label={name} className={className}>
      <PanelRight size={17} aria-hidden="true" />
    </button>
  );
}
