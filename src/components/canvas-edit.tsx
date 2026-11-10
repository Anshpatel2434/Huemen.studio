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
 * - Select and instruct: with `onAsk`, a single click on the text opens a small
 *   box beside it ("make it punchier"). The model's rewrite is committed
 *   through the same `onCommit` as typing, so it shows at once, saves in the
 *   background and undoes with ⌘Z like any other edit.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Sparkles } from "lucide-react";
import { AgentDots, useToast } from "@/components/ui";

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
        toast("Couldn't do that. Try again.", "danger");
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
  value, onCommit, multiline = false, required = false, placeholder = "Double-click to edit", className = "", style, display, editing: editingProp, onEditingChange, label, onAsk,
}: {
  value: string;
  /** Persist the new text. Throwing restores the old value. `asked` marks a model rewrite, not typing. */
  onCommit: (next: string, prev: string, meta?: { asked?: boolean }) => Promise<unknown>;
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
  /** Select and instruct: rewrite this text as asked. Resolves to the new text; throwing shows the message. */
  onAsk?: (instruction: string, current: string) => Promise<string>;
}) {
  const toast = useToast();
  const [own, setOwn] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const [asking, setAsking] = useState<DOMRect | null>(null);
  const [rewriting, setRewriting] = useState(false);
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
      toast("Couldn't save that edit. It was put back.", "danger");
    });
  };

  const ask = async (instruction: string) => {
    if (!onAsk) return;
    setRewriting(true);
    try {
      const next = (await onAsk(instruction, shown)).trim();
      setAsking(null);
      if (!next || next === shown) return toast("That came back unchanged. Try saying it another way.");
      const prev = shown;
      setPending({ from: value, to: next });
      await onCommit(next, prev, { asked: true }).catch((e) => { setPending(null); throw e; });
      toast(`Rewritten. ${typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}Z undoes it.`);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "That didn't work. Try again.", "danger");
    } finally {
      setRewriting(false);
    }
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
        className={`${className} block w-full resize-none bg-transparent select-text outline-none rounded-xs ring-2 ring-current/70 m-0 p-0 border-0`}
        style={{ ...style, fieldSizing: "content", font: "inherit", color: "inherit", letterSpacing: "inherit", lineHeight: "inherit" } as CSSProperties}
      />
    );
  }

  const open = () => { if (onAsk && anchor.current) setAsking(anchor.current.getBoundingClientRect()); };

  return (
    <>
      <span
        ref={anchor}
        role="textbox"
        aria-readonly
        aria-label={label}
        tabIndex={0}
        title={onAsk ? "Click to ask for a change · double-click to edit" : "Double-click to edit"}
        onClick={onAsk ? open : undefined}
        onDoubleClick={(e) => { e.stopPropagation(); setAsking(null); begin(); }}
        onKeyDown={(e) => {
          if (e.currentTarget !== e.target) return;
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); begin(); }
          // "/" asks, like a command palette on the selection.
          if (e.key === "/" && onAsk) { e.preventDefault(); e.stopPropagation(); open(); }
        }}
        className={`${className} block cursor-text rounded-xs outline-none hover:ring-1 hover:ring-current/25 focus-visible:ring-2 focus-visible:ring-current/60 ${asking ? "ring-2 ring-[var(--accent)]" : ""} ${rewriting ? "animate-pulse" : ""} ${multiline ? "whitespace-pre-wrap" : ""}`}
        style={style}
      >
        {shown ? (display && shown === value ? display : shown) : <span className="opacity-45 italic">{placeholder}</span>}
      </span>
      {asking && onAsk && <AskBox rect={asking} label={label ?? "this"} busy={rewriting} onAsk={ask} onClose={() => !rewriting && setAsking(null)} />}
    </>
  );
}

// -------------------------------------------------- select and instruct ---

const ASK_CHIPS = ["Shorter", "Punchier", "More contrarian", "Warmer", "As a question"];
/** One box open at a time, across every canvas. */
const ASK_EVENT = "huemen:ask-open";

function AskBox({ rect, label, busy, onAsk, onClose }: {
  rect: DOMRect; label: string; busy: boolean; onAsk: (instruction: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    id.current ??= Math.random().toString(36);
    window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: id.current }));
    const other = (e: Event) => { if ((e as CustomEvent).detail !== id.current) closeRef.current(); };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) closeRef.current(); };
    // The canvas pans and zooms under the box; it is anchored to where the text WAS, so it closes.
    const moved = () => closeRef.current();
    window.addEventListener(ASK_EVENT, other);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("wheel", moved, { passive: true });
    window.addEventListener("resize", moved);
    return () => {
      window.removeEventListener(ASK_EVENT, other);
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("wheel", moved);
      window.removeEventListener("resize", moved);
    };
  }, []);

  const W = 340;
  const below = rect.bottom + 8 + 120 < window.innerHeight;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, rect.left));
  const top = below ? rect.bottom + 8 : Math.max(8, rect.top - 128);
  const send = (t: string) => { if (t.trim() && !busy) onAsk(t.trim()); };

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={`Ask for a change to ${label}`}
      className="fixed pop bg-paper border border-hairline rounded-md shadow-[var(--shadow-overlay)] p-2.5 flex flex-col gap-2"
      style={{ left, top, width: W, zIndex: "var(--z-modal)" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); send(text); }}
      >
        <Sparkles size={15} className="text-accent shrink-0 ml-1" aria-hidden="true" />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
          placeholder={`Change this ${label.toLowerCase()}…`}
          aria-label={`What to change in this ${label.toLowerCase()}`}
          disabled={busy}
          className="flex-1 min-w-0 min-h-10 bg-transparent outline-none text-sm px-1"
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Rewrite" className="hu-iconbtn !w-9 !h-9 !min-h-9 bg-ink text-on-ink disabled:opacity-40">
          {busy ? <AgentDots /> : <ArrowUp size={15} />}
        </button>
      </form>
      <div className="flex flex-wrap gap-1">
        {ASK_CHIPS.map((c) => (
          <button key={c} type="button" disabled={busy} onClick={() => send(c)} className="h-8 px-2.5 rounded-full border border-line text-xs hover:bg-hover disabled:opacity-40">
            {c}
          </button>
        ))}
      </div>
      <p className="text-[0.7rem] text-ink-faint px-1">{busy ? "Rewriting in your voice…" : "Applied straight to the canvas. Undo brings it back."}</p>
    </div>,
    document.body,
  );
}
