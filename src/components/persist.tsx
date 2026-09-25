"use client";

/**
 * Draft persistence — nothing a user types is lost on refresh, tab close or a
 * failed navigation. Two tools:
 *
 *  - useDraftPersist(key, value, restore): for CONTROLLED inputs (useState).
 *    Restores a saved value once on mount, then autosaves (debounced) on change.
 *  - <PersistForm storageKey action>: wraps an UNCONTROLLED server-action form
 *    (fields with defaultValue). Restores saved field values on mount, autosaves
 *    on input, and clears the draft on submit (the server now has it).
 *
 * Storage is localStorage, per-key, best-effort (wrapped in try/catch so private
 * mode or a full quota never breaks the page). Keys should include the tenant +
 * project + surface so two projects never share a draft.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

const DEBOUNCE = 500;

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function useDraftPersist<T>(key: string | null, value: T, restore: (v: T) => void) {
  const [ready, setReady] = useState(false);
  // Restore once, then allow saving. Both state updates batch, so the first save
  // sees the restored value, not the initial one.
  useEffect(() => {
    if (!key) {
      setReady(true);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) restore(JSON.parse(raw) as T);
    } catch {}
    setReady(true);
    // restore only when the key changes; `restore` is intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!ready || !key) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    }, DEBOUNCE);
    return () => clearTimeout(id);
  }, [ready, key, value]);
}

const SKIP_TYPES = new Set(["file", "password", "submit", "button", "hidden", "reset"]);

export function PersistForm({
  storageKey,
  action,
  className,
  children,
  ...rest
}: {
  storageKey: string;
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  children: ReactNode;
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, "action">) {
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = ref.current;
    if (!form) return;

    const fields = () =>
      Array.from(form.elements).filter((el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
        const name = (el as HTMLInputElement).name;
        const type = (el as HTMLInputElement).type ?? "";
        return Boolean(name) && !SKIP_TYPES.has(type);
      });

    // Restore.
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw) as Record<string, string>;
        for (const el of fields()) {
          if (el.name in data && data[el.name] !== "") el.value = data[el.name];
        }
      }
    } catch {}

    // Autosave (debounced) on any input.
    let t: ReturnType<typeof setTimeout>;
    const save = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          const data: Record<string, string> = {};
          for (const el of fields()) data[el.name] = el.value;
          localStorage.setItem(storageKey, JSON.stringify(data));
        } catch {}
      }, DEBOUNCE);
    };
    const onSubmit = () => clearDraft(storageKey);

    form.addEventListener("input", save);
    form.addEventListener("submit", onSubmit);
    return () => {
      clearTimeout(t);
      form.removeEventListener("input", save);
      form.removeEventListener("submit", onSubmit);
    };
  }, [storageKey]);

  return (
    <form ref={ref} action={action} className={className} {...rest}>
      {children}
    </form>
  );
}
