"use client";

/**
 * Editing primitives for the canvases (Figma/Relume behaviour):
 * - <EditableText>: double-click text on the canvas to edit it where it sits.
 *   Enter commits (⌘/Ctrl+Enter in multi-line fields), Esc cancels, clicking
 *   away commits. The new text shows immediately and is saved in the
 *   background; a failed save puts the old text back.
 * - <CanvasHistory> + useCanvasHistory(): ⌘Z / ⌘⇧Z (Ctrl+Z / Ctrl+Y) undo and
 *   redo for inline edits, reorders and moves on the current canvas.
 * - useDeleteKey(): Delete / Backspace acts on the selected item.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useToast } from "@/components/ui";

// ------------------------------------------------------------ history ---

type Step = { label: string; undo: () => Promise<unknown>; redo: () => Promise<unknown> };
type HistoryCtx = { push: (s: Step) => void };
const Ctx = createContext<HistoryCtx>({ push: () => {} });

const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]");

export function CanvasHistory({ children }: { children: ReactNode }) {
  const toast = useToast();
  const past = useRef<Step[]>([]);
  const future = useRef<Step[]>([]);
  const busy = useRef(false);

  const push = useCallback((s: Step) => {
    past.current = [...past.current.slice(-49), s];
    future.current = [];
  }, []);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || typing(e.target)) return;
      const k = e.key.toLowerCase();
      const redo = (k === "z" && e.shiftKey) || k === "y";
      if (k !== "z" && !redo) return;
      e.preventDefault();
      if (busy.current) return;
      const from = redo ? future : past;
      const to = redo ? past : future;
      const step = from.current.at(-1);
      if (!step) return toast(redo ? "Nothing to redo" : "Nothing to undo");
      busy.current = true;
      from.current = from.current.slice(0, -1);
      try {
        await (redo ? step.redo() : step.undo());
        to.current = [...to.current, step];
        toast(`${redo ? "Redo" : "Undo"}: ${step.label}`);
      } catch {
        toast("Couldn't do that. Try again.");
      }
      busy.current = false;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);

  return <Ctx.Provider value={{ push }}>{children}</Ctx.Provider>;
}

export const useCanvasHistory = () => useContext(Ctx);

/** Delete / Backspace on the canvas (not while typing) runs `onDelete` for the selection. */
export function useDeleteKey(onDelete: (() => void) | null) {
  useEffect(() => {
    if (!onDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && !typing(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onDelete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDelete]);
}

// ------------------------------------------------------- editable text ---

export function EditableText({
  value, onCommit, multiline = false, required = false, placeholder = "Double-click to edit", className = "", style, display, editing: editingProp, onEditingChange, label,
}: {
  value: string;
  /** Persist the new text. Throwing restores the old value. */
  onCommit: (next: string, prev: string) => Promise<unknown>;
  multiline?: boolean;
  /** Empty text is not saved (names). */
  required?: boolean;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  /** Custom rendering while not editing (e.g. highlighted don't-words). */
  display?: ReactNode;
  /** Optional control from outside (e.g. "Rename" in a menu, a new item). */
  editing?: boolean;
  onEditingChange?: (on: boolean) => void;
  label?: string;
}) {
  const toast = useToast();
  const [own, setOwn] = useState(false);
  const editing = editingProp ?? own;
  const setEditing = (on: boolean) => { setOwn(on); onEditingChange?.(on); };
  const [draft, setDraft] = useState(value);
  // Entering edit mode (double-click, a menu's "Rename", a fresh item) starts from the current text.
  const [wasEditing, setWasEditing] = useState(editing);
  // Optimistic: show the new text until the server's value catches up.
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  // Once the server value moves on (saved, or later undone), drop the overlay.
  if (pending && value !== pending.from) setPending(null);
  const shown = pending ? pending.to : value;
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setDraft(shown);
  }

  const begin = () => setEditing(true);
  const cancel = () => setEditing(false);
  const commit = () => {
    setEditing(false);
    const next = multiline ? draft.replace(/\s+$/, "") : draft.trim();
    if (next === shown || (required && !next)) return;
    const prev = shown;
    setPending({ from: value, to: next });
    onCommit(next, prev).catch(() => {
      setPending(null);
      toast("Couldn't save that edit. It was put back.");
    });
  };

  if (editing) {
    return (
      <textarea
        ref={(el) => {
          if (el && document.activeElement !== el) { el.focus(); el.select(); }
        }}
        aria-label={label ?? "Edit text"}
        value={draft}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
          if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        }}
        className={`${className} block w-full resize-none bg-transparent select-text outline-none rounded-[3px] ring-2 ring-current/70 m-0 p-0 border-0`}
        style={{ ...style, fieldSizing: "content", font: "inherit", color: "inherit", letterSpacing: "inherit", lineHeight: "inherit" } as CSSProperties}
      />
    );
  }

  return (
    <span
      role="textbox"
      aria-readonly
      aria-label={label}
      tabIndex={0}
      title="Double-click to edit"
      onDoubleClick={(e) => { e.stopPropagation(); begin(); }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.currentTarget === e.target) { e.preventDefault(); e.stopPropagation(); begin(); } }}
      className={`${className} block cursor-text rounded-[3px] outline-none hover:ring-1 hover:ring-current/25 focus-visible:ring-2 focus-visible:ring-current/60 ${multiline ? "whitespace-pre-wrap" : ""}`}
      style={style}
    >
      {shown ? (display && shown === value ? display : shown) : <span className="opacity-45 italic">{placeholder}</span>}
    </span>
  );
}
