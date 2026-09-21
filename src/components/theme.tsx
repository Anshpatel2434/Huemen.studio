"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun, Monitor } from "lucide-react";
import { saveThemeAction } from "@/app/settings/actions";
import type { Theme, ThemePref } from "@/lib/theme";

/**
 * Light / dark view. The root layout renders `<html data-theme>` from the
 * cookie, so the first paint is already right; this provider swaps it on the
 * client (no reload) and saves the choice in the background. The swap runs
 * inside a view transition so the whole screen crossfades slowly, in step
 * with the page transitions.
 */
type Ctx = { pref: ThemePref; resolved: Theme; setTheme: (t: ThemePref) => void };
const ThemeContext = createContext<Ctx | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";
function subscribeOs(cb: () => void) {
  const m = window.matchMedia(DARK_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

export function ThemeProvider({ initial, children }: { initial: ThemePref; children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(initial);
  const osDark = useSyncExternalStore(subscribeOs, () => window.matchMedia(DARK_QUERY).matches, () => true);
  const resolved: Theme = pref === "system" ? (osDark ? "dark" : "light") : pref;

  const setTheme = useCallback((next: ThemePref) => {
    const swap = () => {
      document.documentElement.dataset.theme = next;
      flushSync(() => setPref(next));
    };
    const calm = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm && typeof document.startViewTransition === "function") {
      document.documentElement.classList.add("theme-switching");
      document.startViewTransition(swap).finished.finally(() => document.documentElement.classList.remove("theme-switching"));
    } else {
      swap();
    }
    void saveThemeAction(next);
  }, []);

  return <ThemeContext.Provider value={{ pref, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme needs <ThemeProvider>");
  return ctx;
}

/** Icon button for tight chrome (editor rail, sign-in corner): flips light ⇄ dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolved, setTheme } = useTheme();
  const next: Theme = resolved === "dark" ? "light" : "dark";
  const Icon = resolved === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Switch to ${next} view`}
      aria-label={`Switch to ${next} view`}
      className={`w-8 h-8 rounded-[8px] flex items-center justify-center text-ink-muted hover:bg-field hover:text-ink transition-colors ${className}`}
    >
      <Icon size={16} />
    </button>
  );
}

/** Two-segment Light | Dark control (sidebar, menus). "System" shows neither as pressed. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const { pref, setTheme } = useTheme();
  const opts: { v: Theme; label: string; icon: typeof Sun }[] = [
    { v: "light", label: "Light", icon: Sun },
    { v: "dark", label: "Dark", icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label="Appearance" className={`grid grid-cols-2 gap-0.5 p-0.5 rounded-[9px] bg-field ${className}`}>
      {opts.map(({ v, label, icon: Icon }) => {
        const on = pref === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(v)}
            className={`h-7 rounded-[7px] flex items-center justify-center gap-1.5 text-[0.76rem] font-medium transition-colors ${on ? "bg-paper text-ink shadow-[var(--shadow-sm)]" : "text-ink-muted hover:text-ink"}`}
          >
            <Icon size={13} /> {label}
          </button>
        );
      })}
    </div>
  );
}

/** Settings → Appearance: preview cards for Dark / Light / System. */
export function ThemePicker() {
  const { pref, setTheme } = useTheme();
  const opts: { v: ThemePref; label: string; icon: typeof Sun; hint: string }[] = [
    { v: "light", label: "Light", icon: Sun, hint: "White panels, black ink" },
    { v: "dark", label: "Dark", icon: Moon, hint: "Figma-style greys" },
    { v: "system", label: "System", icon: Monitor, hint: "Follows your device" },
  ];
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {opts.map(({ v, label, icon: Icon, hint }) => {
        const on = pref === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(v)}
            className={`w-full rounded-[10px] border p-3 text-left transition-colors ${on ? "border-ink ring-1 ring-ink" : "border-hairline hover:border-line"}`}
          >
            <span className="flex h-20 rounded-[6px] mb-2.5 border border-hairline overflow-hidden">
              {v === "system" ? (
                <>
                  <Preview tone="light" half />
                  <Preview tone="dark" half />
                </>
              ) : (
                <Preview tone={v} />
              )}
            </span>
            <span className="flex items-center gap-1.5 text-[0.82rem] font-medium"><Icon size={13} /> {label}</span>
            <span className="block text-[0.72rem] text-ink-faint mt-0.5">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A miniature of the editor (top bar, side panel, one artboard) in fixed colours. */
function Preview({ tone, half = false }: { tone: Theme; half?: boolean }) {
  const c = tone === "light"
    ? { ground: "#f4f4f4", paper: "#ffffff", line: "rgba(0,0,0,0.09)", bar: "#dcdcdc", ink: "#0a0a0a" }
    : { ground: "#181818", paper: "#262626", line: "rgba(255,255,255,0.08)", bar: "#444444", ink: "#f5f5f5" };
  return (
    <span className="flex-1 flex flex-col" style={{ background: c.ground }}>
      <span className="h-3 shrink-0 flex items-center gap-1 px-1.5" style={{ background: c.paper, borderBottom: `1px solid ${c.line}` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.ink }} />
        <span className="w-6 h-[3px] rounded-full" style={{ background: c.bar }} />
      </span>
      <span className="flex-1 flex min-h-0">
        {!half && (
          <span className="w-8 shrink-0 flex flex-col gap-1 p-1.5" style={{ background: c.paper, borderRight: `1px solid ${c.line}` }}>
            <span className="h-[3px] rounded-full" style={{ background: c.bar }} />
            <span className="h-[3px] w-3/4 rounded-full" style={{ background: c.bar }} />
            <span className="h-[3px] w-1/2 rounded-full" style={{ background: c.bar }} />
          </span>
        )}
        <span className="flex-1 flex items-center justify-center">
          <span className="w-9 h-9 rounded-[3px] bg-white flex flex-col gap-[3px] p-1.5 shadow-sm">
            <span className="h-[3px] rounded-full bg-[#0a0a0a]" />
            <span className="h-[3px] w-2/3 rounded-full bg-[#dcdcdc]" />
            <span className="h-[3px] w-1/2 rounded-full bg-[#dcdcdc]" />
          </span>
        </span>
      </span>
    </span>
  );
}
