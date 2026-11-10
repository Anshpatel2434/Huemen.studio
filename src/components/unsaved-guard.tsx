"use client";

/**
 * Unsaved changes: one mechanism for every form and editor (never the
 * browser's own "Leave site?" prompt; house rule no. 1 is no system UI).
 *
 *  - useUnsavedChanges({ dirty, storageKey, value, onRestore }): for
 *    CONTROLLED editors (useState). Says whether there are unsaved edits,
 *    keeps them in localStorage while there are, and returns a quiet bar that
 *    offers them back ("Restore / Discard") the next time the page opens.
 *  - <GuardedForm storageKey action>: the same for an UNCONTROLLED server
 *    action form (fields with defaultValue). Dirty means a field no longer
 *    matches its default; a submit counts as saved.
 *  - <UnsavedGuardRoot />: mounted once in the root layout. While anything is
 *    dirty, an in-app link (capture-phase click on <a href>) or the back
 *    button asks "Leave without saving?" (Stay / Leave) in Huemen's own dialog.
 *    Reload and tab close can't be asked about without system UI, so they are
 *    covered by the saved copy and the Restore bar instead.
 *  - guardedLeave(go): for programmatic moves (router.push on a button), asks
 *    first when something is dirty, else just goes.
 *
 * Storage is best-effort: every access is wrapped, so private mode or a full
 * quota never breaks a page. Keys are `huemen:unsaved:<workspace>:<form>`;
 * they are an account's drafts and go on sign-out (components/persist).
 */
import { useCallback, useEffect, useRef, useState, type FormHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { ConfirmModal } from "@/components/confirm-modal";
import { btnClass } from "@/components/btn";

export { UNSAVED_PREFIX, unsavedKey } from "@/lib/ui/unsaved";

// ------------------------------------------------------------- storage ---

function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as { v?: T };
    return parsed && typeof parsed === "object" && "v" in parsed ? (parsed.v as T) : null;
  } catch {
    return null;
  }
}
function writeStored(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ v, at: Date.now() }));
  } catch {}
}
function removeStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

// ------------------------------------------------------------ registry ---

type Entry = { dirty: boolean; discard: () => void };
const entries = new Map<number, Entry>();
let seq = 0;

export function hasUnsavedChanges() {
  for (const e of entries.values()) if (e.dirty) return true;
  return false;
}

/** The root guard's hooks into history and its dialog (null until it mounts). */
let root: {
  ask: (go: () => void) => void;
  arm: () => void;
  settle: () => void;
} | null = null;

/** Run `go` now, or after "Leave" if something on the page is unsaved. */
export function guardedLeave(go: () => void) {
  if (!root || !hasUnsavedChanges()) return go();
  root.ask(go);
}

function discardAll() {
  for (const e of entries.values()) {
    if (e.dirty) {
      e.discard();
      e.dirty = false;
    }
  }
}

// ---------------------------------------------------------------- hook ---

const DEBOUNCE = 400;

/**
 * Track one editor. `dirty` is the caller's own "differs from last saved";
 * with a `storageKey` and `value`, the edits are also kept locally while dirty
 * and offered back on the next visit through the returned `bar`.
 */
export function useUnsavedChanges<T>({ dirty, storageKey = null, value, onRestore, isSaved }: {
  dirty: boolean;
  storageKey?: string | null;
  value?: T;
  /** Put a kept draft back into the editor. Without it nothing is stored. */
  onRestore?: (v: T) => void;
  /** True when a kept draft is no different from what is saved now (it is then dropped quietly). */
  isSaved?: (v: T) => boolean;
}): { bar: ReactNode; discard: () => void } {
  const id = useRef<number | null>(null);
  const keep = Boolean(storageKey && onRestore);
  const [earlier, setEarlier] = useState<{ v: T } | null>(null);
  const [checked, setChecked] = useState(false);
  const discarded = useRef(false);
  const latest = useRef({ dirty, value, storageKey, keep });
  useEffect(() => { latest.current = { dirty, value, storageKey, keep }; });

  // Register once; drop out on unmount. Unmounting while dirty KEEPS the
  // stored copy (the page went somewhere the guard couldn't ask about).
  useEffect(() => {
    const n = ++seq;
    id.current = n;
    entries.set(n, {
      dirty: false,
      discard: () => {
        discarded.current = true;
        const { storageKey: k } = latest.current;
        if (k) removeStored(k);
      },
    });
    return () => {
      const { dirty: d, value: v, storageKey: k, keep: kp } = latest.current;
      if (d && kp && k && !discarded.current) writeStored(k, v);
      const was = entries.get(n)?.dirty;
      entries.delete(n);
      // Gone while dirty: if that left nothing unsaved, tidy the back-button
      // guard (a no-op when the page has already moved on).
      if (was) root?.settle();
    };
  }, []);

  // On open: a draft kept from an earlier visit is offered back, unless it
  // says what is already saved.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reading browser storage after hydration */
    if (!keep || !storageKey) { setChecked(true); return; }
    const v = readStored<T>(storageKey);
    if (v != null && !(isSaved?.(v) ?? false)) setEarlier({ v });
    else if (v != null) removeStored(storageKey);
    setChecked(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Only when the key changes; isSaved is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, keep]);

  // Mirror dirty into the registry; arm the back-button guard on the way in,
  // settle it on the way out (saved).
  const wasDirty = useRef(false);
  useEffect(() => {
    const e = id.current != null ? entries.get(id.current) : undefined;
    if (!e) return;
    e.dirty = dirty;
    if (dirty) discarded.current = false;
    if (dirty && !wasDirty.current) root?.arm();
    if (!dirty && wasDirty.current) root?.settle();
    wasDirty.current = dirty;
  }, [dirty]);

  // Keep the edits while dirty; forget them once clean (saved or undone).
  // While an earlier draft is on offer, storage is left alone.
  useEffect(() => {
    if (!keep || !storageKey || !checked || earlier) return;
    if (!dirty) { removeStored(storageKey); return; }
    const t = setTimeout(() => writeStored(storageKey, value), DEBOUNCE);
    return () => clearTimeout(t);
  }, [keep, storageKey, checked, earlier, dirty, value]);

  // A tab closed mid-debounce still keeps the last words.
  useEffect(() => {
    if (!keep) return;
    const flush = () => {
      const { dirty: d, value: v, storageKey: k } = latest.current;
      if (d && k && !discarded.current) writeStored(k, v);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [keep]);

  const discard = useCallback(() => {
    discarded.current = true;
    if (storageKey) removeStored(storageKey);
  }, [storageKey]);

  const bar = earlier ? (
    <RestoreBar
      onRestore={() => { const v = earlier.v; setEarlier(null); onRestore?.(v); }}
      onDiscard={() => { setEarlier(null); if (storageKey) removeStored(storageKey); }}
    />
  ) : null;

  return { bar, discard };
}

/** The quiet inline offer: an earlier visit left edits that were never saved. */
export function RestoreBar({ onRestore, onDiscard, className = "" }: { onRestore: () => void; onDiscard: () => void; className?: string }) {
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-hairline bg-panel pl-4 pr-2 py-1.5 text-sm ${className}`}>
      <History size={15} className="text-ink-faint shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-[12rem] text-ink-muted">You have unsaved changes from earlier.</span>
      <span className="flex items-center gap-1">
        <button type="button" onClick={onRestore} className={btnClass("secondary", "sm")}>Restore</button>
        <button type="button" onClick={onDiscard} className={btnClass("ghost", "sm")}>Discard</button>
      </span>
    </div>
  );
}

// ------------------------------------------------------- guarded form ---

const SKIP_TYPES = new Set(["file", "password", "submit", "button", "hidden", "reset", "image"]);
type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Snapshot = Record<string, string>;

function controls(form: HTMLFormElement): Control[] {
  return Array.from(form.elements).filter((el): el is Control => {
    const c = el as HTMLInputElement;
    return Boolean(c.name) && !SKIP_TYPES.has(c.type ?? "") && !c.readOnly && !c.disabled;
  });
}
const isChoice = (c: Control): c is HTMLInputElement => c instanceof HTMLInputElement && (c.type === "checkbox" || c.type === "radio");
/** A textarea's value always uses \n; the text it was rendered with may not. */
const nl = (v: string) => v.replace(/\r\n?/g, "\n");
const slot = (c: Control) => (isChoice(c) ? `${c.name}::${c.value}` : c.name);

/** What the person has typed or picked now, by field. */
function current(form: HTMLFormElement): Snapshot {
  const s: Snapshot = {};
  for (const c of controls(form)) s[slot(c)] = isChoice(c) ? (c.checked ? "1" : "") : nl(c.value);
  return s;
}
/** What the page was rendered with (the last saved values). */
function defaults(form: HTMLFormElement): Snapshot {
  const s: Snapshot = {};
  for (const c of controls(form)) {
    if (isChoice(c)) s[slot(c)] = c.defaultChecked ? "1" : "";
    else if (c instanceof HTMLSelectElement) s[slot(c)] = Array.from(c.options).find((o) => o.defaultSelected)?.value ?? c.options[0]?.value ?? "";
    else s[slot(c)] = nl(c.defaultValue);
  }
  return s;
}
const same = (a: Snapshot, b: Snapshot) => Object.keys(b).every((k) => (a[k] ?? b[k]) === b[k]);

/**
 * A server-action form whose unsaved edits are guarded and kept. Drop-in for
 * `<form action>`: the same props, plus `storageKey` (use unsavedKey()).
 */
export function GuardedForm({ storageKey, action, className, children, onSubmit, ...rest }: {
  storageKey: string;
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  children: ReactNode;
} & Omit<FormHTMLAttributes<HTMLFormElement>, "action">) {
  const ref = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [value, setValue] = useState<Snapshot>({});

  const measure = useCallback(() => {
    const form = ref.current;
    if (!form) return;
    const now = current(form);
    setValue(now);
    setDirty(!same(now, defaults(form)));
  }, []);

  const apply = useCallback((v: Snapshot) => {
    const form = ref.current;
    if (!form) return;
    for (const c of controls(form)) {
      const k = slot(c);
      if (!(k in v)) continue;
      if (isChoice(c)) c.checked = v[k] === "1";
      else c.value = v[k];
    }
    // As if typed: anything listening to the form (a live preview) follows, and so does dirty.
    form.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  const { bar, discard } = useUnsavedChanges<Snapshot>({
    dirty,
    storageKey,
    value,
    onRestore: apply,
    isSaved: (v) => { const form = ref.current; return !form || same(v, defaults(form)); },
  });

  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const onEdit = () => measure();
    // React resets a form after its action succeeds; the fields then hold the
    // new saved values (or the old ones), so measure again once it has.
    const onReset = () => setTimeout(measure, 0);
    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    form.addEventListener("reset", onReset);
    return () => {
      form.removeEventListener("input", onEdit);
      form.removeEventListener("change", onEdit);
      form.removeEventListener("reset", onReset);
    };
  }, [measure]);

  return (
    <>
      {/* Above the form, not in it: a form laid out as a row keeps its row. */}
      {bar && <div className="mb-3 w-full">{bar}</div>}
      <form
        ref={ref}
        action={action}
        className={className}
        onSubmit={(e) => {
          onSubmit?.(e);
          // Sent: the server has it now. (A refused save shows its own error.)
          discard();
          setDirty(false);
        }}
        {...rest}
      >
        {children}
      </form>
    </>
  );
}

// ---------------------------------------------------------------- root ---

/**
 * Mounted once (app/layout). Asks before an in-app link or the back button
 * leaves a page with unsaved edits.
 *
 * The back button: when something first goes dirty, one extra history entry
 * (same URL) is pushed. Back then lands on the real entry without leaving the
 * page; the popstate is kept from the router (capture phase, before Next's own
 * listener), and the dialog asks. Stay puts the extra entry back; Leave goes
 * back for real. When the edits are saved, the extra entry is taken off again.
 */
export function UnsavedGuardRoot() {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  // What Stay does: nothing for a link; re-arm (or walk the URL back) after Back.
  const [stayHook, setStayHook] = useState<(() => void) | null>(null);

  useEffect(() => {
    let armed = false; // the extra entry is on the stack
    let armedAt = ""; // ...for this URL
    let leaving = false; // the next popstate is ours to let through
    let swallow = false; // the next popstate is ours to hide

    const ask = (go: () => void) => setPending(() => go);

    const arm = () => {
      if (armed) return;
      try {
        // No URL: Next copies its own state onto the entry and nothing re-renders.
        window.history.pushState({ huemenUnsaved: 1 }, "");
        armed = true;
        armedAt = window.location.href;
      } catch {}
    };
    // Saved: take the extra entry off, if we are still standing on it.
    const settle = () => {
      if (!armed || hasUnsavedChanges()) return;
      armed = false;
      if (window.location.href !== armedAt) return;
      swallow = true;
      window.history.back();
    };

    root = { ask, arm, settle };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
      if (!hasUnsavedChanges()) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (!/^https?:$/.test(url.protocol)) return; // mailto:, tel:
      const here = new URL(window.location.href);
      if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search) return; // an anchor on this page
      e.preventDefault();
      e.stopImmediatePropagation();
      ask(() => {
        if (url.origin !== here.origin) { window.location.assign(url.href); return; }
        const to = `${url.pathname}${url.search}${url.hash}`;
        // Standing on the extra entry: replace it, so history reads as if it was never there.
        if (armed && window.location.href === armedAt) { armed = false; router.replace(to); }
        else router.push(to);
      });
    };

    const onPop = (e: PopStateEvent) => {
      if (swallow) { swallow = false; e.stopImmediatePropagation(); return; }
      if (leaving) { leaving = false; return; }
      if (!armed) return;
      armed = false; // the extra entry has been stepped off
      // History jumped further than the extra entry (several steps at once, or
      // the URL changed since): let the router follow. The edits are still
      // kept locally and offered back when the page opens again.
      if (!hasUnsavedChanges() || window.location.href !== armedAt) return;
      // Back from the extra entry onto this same page: nothing has moved yet.
      e.stopImmediatePropagation();
      ask(() => { leaving = true; window.history.back(); });
      setStayHook(() => arm);
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop, true);
    return () => {
      root = null;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop, true);
    };
  }, [router]);

  const stay = () => {
    const s = stayHook;
    setPending(null);
    setStayHook(null);
    s?.();
  };
  const leave = () => {
    const go = pending;
    setPending(null);
    setStayHook(null);
    discardAll();
    go?.();
  };

  return (
    <ConfirmModal
      open={pending !== null}
      title="Leave without saving?"
      confirmLabel="Leave"
      cancelLabel="Stay"
      danger
      focusCancel
      onClose={stay}
      onConfirm={leave}
    >
      Your changes on this page haven&apos;t been saved. If you leave now, they&apos;re gone.
    </ConfirmModal>
  );
}
