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
      className={`hu-iconbtn ${className}`}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

/** Light | Dark | Auto control (sidebar, menus). Auto follows the device, the default. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const { pref, setTheme } = useTheme();
  const opts: { v: ThemePref; label: string; icon: typeof Sun; title: string }[] = [
    { v: "light", label: "Light", icon: Sun, title: "Light view" },
    { v: "dark", label: "Dark", icon: Moon, title: "Dark view" },
    { v: "system", label: "Auto", icon: Monitor, title: "Follow this device" },
  ];
  return (
    <div role="radiogroup" aria-label="Appearance" className={`hu-seg !grid grid-cols-3 w-full ${className}`}>
      {opts.map(({ v, label, icon: Icon, title }) => {
        const on = pref === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            title={title}
            onClick={() => setTheme(v)}
            className="hu-seg__item !px-2"
          >
            <Icon size={14} aria-hidden="true" /> {label}
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
            className={`w-full rounded-md border p-3 text-left transition-colors ${on ? "border-ink ring-1 ring-ink" : "border-hairline hover:border-line"}`}
          >
            <span className="flex h-20 rounded-sm mb-2.5 border border-hairline overflow-hidden">
              {v === "system" ? (
                <>
                  <Preview tone="light" half />
                  <Preview tone="dark" half />
                </>
              ) : (
                <Preview tone={v} />
              )}
            </span>
            <span className="flex items-center gap-1.5 text-sm font-medium"><Icon size={13} /> {label}</span>
            <span className="block text-xs text-ink-faint mt-0.5">{hint}</span>
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
          <span className="w-9 h-9 rounded-xs bg-white flex flex-col gap-[3px] p-1.5 shadow-sm">
            <span className="h-[3px] rounded-full bg-[#0a0a0a]" />
            <span className="h-[3px] w-2/3 rounded-full bg-[#dcdcdc]" />
            <span className="h-[3px] w-1/2 rounded-full bg-[#dcdcdc]" />
          </span>
        </span>
      </span>
    </span>
  );
}
