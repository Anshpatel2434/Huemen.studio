"use client";

/**
 * Onboarding checkpoints, the in-browser half.
 *
 * The server half is `voice_packs.onboarding`: which step they reached, every
 * answer they saved. This half is everything typed or picked but not saved yet
 * (a paste, a half-written answer, three of eight dial picks), kept per person
 * so a refresh, a closed tab or a dropped connection gives it back.
 *
 * A draft remembers the saved value it started from. If that value changed on
 * the server in the meantime (they finished on another device, a coach's change
 * was approved), the draft is stale and is dropped rather than shown over newer
 * data. A draft equal to what's saved is removed, so saving clears it.
 *
 * Outside <OnboardingDrafts> (the same components on the Voice page) nothing is
 * stored and the hook is plain useState.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const Prefix = createContext<string | null>(null);

export function OnboardingDrafts({ prefix, children }: { prefix: string; children: ReactNode }) {
  return <Prefix.Provider value={prefix}>{children}</Prefix.Provider>;
}

/** The storage prefix for this person's onboarding, or null outside it. */
export const useDraftPrefix = () => useContext(Prefix);

const DEBOUNCE = 400;

type Stored<T> = { v: T; base: string };

const read = <T,>(key: string): Stored<T> | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Stored<T>) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const remove = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {}
};

/**
 * How many drafts under this prefix are waiting to be saved, among the names
 * matching `only`. A draft equal to the saved value is removed as it happens,
 * so anything left really is unsaved.
 */
export function pendingDrafts(prefix: string, only: RegExp): number {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${prefix}:`) && only.test(k.slice(prefix.length + 1))) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Drop every onboarding draft for this person (the flow is finished). */
export function clearOnboardingDrafts(prefix: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${prefix}:`)) localStorage.removeItem(k);
    }
  } catch {}
}

/**
 * useState that survives a reload. `initial` is the saved value; `name` must be
 * unique within the person's onboarding. `restored` is true when the value
 * shown came back from a draft, so a component can open in its editing state.
 */
export function useStepDraft<T>(name: string, initial: T): [T, (next: T | ((prev: T) => T)) => void, { restored: boolean; discard: () => void }] {
  const prefix = useContext(Prefix);
  const key = prefix ? `${prefix}:${name}` : null;
  const base = JSON.stringify(initial);
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const ready = useRef(false);

  // Restore once per key, before the first save can overwrite the draft. This
  // has to run after mount: the server render can't see localStorage, and
  // reading it during render would make hydration disagree with the server.
  useEffect(() => {
    ready.current = false;
    if (key) {
      const d = read<T>(key);
      if (d && d.base === base && JSON.stringify(d.v) !== base) {
        /* eslint-disable react-hooks/set-state-in-effect -- syncing from browser storage after hydration */
        setValue(d.v);
        setRestored(true);
        /* eslint-enable react-hooks/set-state-in-effect */
      } else if (d) {
        remove(key);
      }
    }
    ready.current = true;
    // `base` is read on purpose only at restore time; see the save effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Save on change. Equal to the saved value means nothing is pending: clear.
  useEffect(() => {
    if (!key || !ready.current) return;
    const t = setTimeout(() => {
      if (JSON.stringify(value) === base) remove(key);
      else write(key, { v: value, base } satisfies Stored<T>);
    }, DEBOUNCE);
    return () => clearTimeout(t);
  }, [key, value, base]);

  const discard = useCallback(() => {
    if (key) remove(key);
    setRestored(false);
  }, [key]);

  return [value, setValue, { restored, discard }];
}
