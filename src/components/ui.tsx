"use client";

/**
 * Huemen UI kit. Relume-shaped controls (rounded 8px, filled fields, white
 * panels on warm grey) in the house palette. Colours come from tokens only.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useId, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Check, X } from "lucide-react";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[8px] bg-ink text-on-ink shrink-0"
      style={{ width: size, height: size }}
      aria-label="Huemen.studio"
    >
      <span className="serif-accent leading-none" style={{ fontSize: size * 0.62, marginTop: -size * 0.04 }}>h</span>
    </span>
  );
}

import { btnClass, type Variant } from "./btn";
export { btnClass };

export function Button({
  children, href, variant = "primary", size = "md", onClick, type = "button", className = "", disabled, title,
}: {
  children: ReactNode; href?: string; variant?: Variant; size?: "sm" | "md"; onClick?: () => void;
  type?: "button" | "submit"; className?: string; disabled?: boolean; title?: string;
}) {
  const cls = `${btnClass(variant, size)} ${className}`;
  if (href) return <Link href={href} className={cls} title={title}>{children}</Link>;
  return <button type={type} onClick={onClick} className={cls} disabled={disabled} title={title}>{children}</button>;
}

/** Submit button that shows a pending state while its form's action runs. */
export function SubmitButton({
  children, pendingLabel, variant = "primary", size = "md", className = "", name, value,
}: { children: ReactNode; pendingLabel?: string; variant?: Variant; size?: "sm" | "md"; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending} className={`${btnClass(variant, size)} ${className}`}>
      {pending ? <><AgentDots /> {pendingLabel ?? "Working…"}</> : children}
    </button>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-paper border border-hairline rounded-[12px] ${className}`}>{children}</div>;
}

/**
 * The eight-hue spectrum the product is named after (design system §04). Avatars,
 * identity marks and illustration fills carry it — never text or borders (those
 * use the signal/ink tiers). `hueFor` maps any stable seed (an id, an email) to
 * one hue so a given person is always the same colour. Yellow is left out of the
 * avatar rotation because white on it fails contrast.
 */
const AVATAR_HUES = ["--hue-coral", "--hue-orange", "--hue-green", "--hue-teal", "--hue-blue", "--hue-violet", "--hue-magenta"];
export function hueFor(seed: string, palette: string[] = AVATAR_HUES): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  return `var(${palette[h % palette.length]})`;
}

export function Avatar({
  seed, label, size = "md", square = false, className = "",
}: { seed: string; label?: string; size?: "sm" | "md" | "lg"; square?: boolean; className?: string }) {
  const s = { sm: "w-7 h-7 text-[0.62rem]", md: "w-9 h-9 text-[0.8rem]", lg: "w-14 h-14 text-[1.1rem]" }[size];
  const initials = (label ?? seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "—";
  return (
    <span aria-hidden="true" className={`${s} ${square ? "rounded-[8px]" : "rounded-full"} inline-flex items-center justify-center font-semibold text-white shrink-0 ${className}`} style={{ background: hueFor(seed) }}>
      {initials}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "danger" | "dark" }) {
  // Design system §11: a mono uppercase pill with a status DOT, so the state is
  // never carried by colour alone.
  const tones: Record<string, { box: string; dot: string }> = {
    neutral: { box: "bg-ground text-ink-muted", dot: "bg-ink-faint" },
    accent: { box: "bg-accent-soft text-accent-ink", dot: "bg-accent" },
    ok: { box: "bg-ok-soft text-ok", dot: "bg-ok" },
    warn: { box: "bg-warn-soft text-warn", dot: "bg-warn" },
    danger: { box: "bg-danger-soft text-danger", dot: "bg-danger" },
    dark: { box: "bg-ink text-on-ink", dot: "bg-on-ink" },
  };
  const t = tones[tone] ?? tones.neutral;
  return (
    <span className={`label-mono inline-flex items-center gap-1.5 px-3 h-6 rounded-full ${t.box}`}>
      <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${t.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Meter({ value, tone = "ink" }: { value: number; tone?: "ink" | "accent" }) {
  return (
    <div className="h-1.5 rounded-full bg-field w-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${tone === "accent" ? "bg-accent" : "bg-ink"}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/** The Relume-style 3×3 "thinking" dots. */
export function AgentDots({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-grid grid-cols-3 gap-[2px] ${className}`} aria-hidden>
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className="w-[3px] h-[3px] rounded-full bg-current" style={{ animation: `dots 1.1s ${(i % 3) * 0.12 + Math.floor(i / 3) * 0.1}s infinite` }} />
      ))}
    </span>
  );
}

export function EmptyState({ title, sub, action, icon }: { title: string; sub?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="text-center py-14 px-6">
      {icon && <div className="mx-auto mb-4 w-11 h-11 rounded-[10px] bg-field flex items-center justify-center text-ink-muted">{icon}</div>}
      <p className="text-[0.95rem] font-medium">{title}</p>
      {sub && <p className="text-[0.85rem] text-ink-muted mt-1.5 max-w-sm mx-auto leading-relaxed">{sub}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 480 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) {
      window.addEventListener("keydown", onKey);
      // Move focus into the dialog so a screen-reader/keyboard user lands here.
      panelRef.current?.focus();
    }
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 fade-in bg-[var(--scrim)]" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Dialog"}
        tabIndex={-1}
        className="bg-paper rounded-[20px] shadow-[var(--shadow-lg)] w-full pop overflow-hidden outline-none"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 h-12 border-b border-hairline">
            <h3 id={titleId} className="text-[0.9rem] font-medium">{title}</h3>
            <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close"><X size={16} /></button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center pointer-events-none" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} role="alert" className="pop flex items-center gap-2 bg-menu text-menu-fg text-[0.82rem] pl-3 pr-4 h-9 rounded-[9px] shadow-[var(--shadow)]">
            <Check size={14} className="text-menu-fg" aria-hidden="true" /> {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
