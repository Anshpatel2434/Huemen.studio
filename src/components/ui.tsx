"use client";

/**
 * Huemen UI kit: the design system's components (§09–§14) as React. The look
 * lives in app/components.css (`hu-*`) and btn.ts; these wire the behaviour
 * and the accessibility the system requires (§17): labels tied to controls,
 * errors announced, busy states, focus that goes in and comes back.
 */
import Link from "next/link";
import {
  createContext, useCallback, useContext, useEffect, useRef, useState, useId,
  type InputHTMLAttributes, type ReactNode, type ReactElement, cloneElement, isValidElement,
} from "react";
import { createPortal, useFormStatus } from "react-dom";
import { AlertTriangle, Check, CheckCircle2, Info, X, XCircle } from "lucide-react";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-sm bg-ink text-on-ink shrink-0"
      style={{ width: size, height: size }}
      aria-label="Huemen.studio"
    >
      <span className="serif-accent leading-none" style={{ fontSize: size * 0.62, marginTop: -size * 0.04 }}>h</span>
    </span>
  );
}

import { btnClass, iconBtnClass, type Size, type Variant } from "./btn";
export { btnClass, iconBtnClass };

export function Button({
  children, href, variant = "primary", size = "md", onClick, type = "button", className = "", disabled, title,
}: {
  children: ReactNode; href?: string; variant?: Variant; size?: Size; onClick?: () => void;
  type?: "button" | "submit"; className?: string; disabled?: boolean; title?: string;
}) {
  const cls = `${btnClass(variant, size)} ${className}`;
  if (href) return <Link href={href} className={cls} title={title}>{children}</Link>;
  return <button type={type} onClick={onClick} className={cls} disabled={disabled} title={title}>{children}</button>;
}

/**
 * Icon-only control: 36px to look at, 44px to hit (§02). The label is required
 * and says the action ("Close", "Remove Warm"), not the icon (§17).
 */
export function IconButton({
  label, onClick, children, pressed, disabled, className = "", type = "button",
}: {
  label: string; onClick?: () => void; children: ReactNode; pressed?: boolean; disabled?: boolean;
  className?: string; type?: "button" | "submit";
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={pressed} className={iconBtnClass(className)}>
      {children}
    </button>
  );
}

/** Submit button that shows a pending state while its form's action runs. */
export function SubmitButton({
  children, pendingLabel, variant = "primary", size = "md", className = "", name, value,
}: { children: ReactNode; pendingLabel?: string; variant?: Variant; size?: Size; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending} className={`${btnClass(variant, size)} ${className}`}>
      {pending ? <><AgentDots /> {pendingLabel ?? "Working…"}</> : children}
    </button>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-paper border border-hairline rounded-md ${className}`}>{children}</div>;
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
  const s = { sm: "w-7 h-7 text-[0.62rem]", md: "w-9 h-9 text-sm", lg: "w-14 h-14 text-lg" }[size];
  const initials = (label ?? seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "—";
  return (
    <span aria-hidden="true" className={`${s} ${square ? "rounded-sm" : "rounded-full"} inline-flex items-center justify-center font-semibold text-white shrink-0 ${className}`} style={{ background: hueFor(seed) }}>
      {initials}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "danger" | "dark" }) {
  // Design system §11: a mono uppercase pill with a status DOT, so the state is
  // never carried by colour alone.
  const tones: Record<string, { box: string; dot: string }> = {
    neutral: { box: "bg-active text-ink-muted", dot: "bg-ink-faint" },
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

/** Empty state (§12): never just "nothing here"; it names the next action. */
export function EmptyState({ title, sub, action, icon, bare = false }: {
  title: string; sub?: string; action?: ReactNode; icon?: ReactNode;
  /** Without the dashed frame, for an empty state already inside a card. */
  bare?: boolean;
}) {
  return (
    <div className={bare ? "text-center py-10 px-6 flex flex-col items-center gap-3" : "hu-empty"}>
      {icon && <div className="hu-empty__art" aria-hidden="true">{icon}</div>}
      <p className="hu-empty__title">{title}</p>
      {sub && <p className="hu-empty__text">{sub}</p>}
      {action && <div className="hu-empty__actions">{action}</div>}
    </div>
  );
}

/**
 * What had focus before a dialog opened, so closing it can hand focus back
 * (§17). Tracked on focusin because React's autoFocus moves focus into the
 * dialog before any of its effects run.
 */
let lastFocusOutsideDialog: HTMLElement | null = null;
if (typeof document !== "undefined") {
  const note = (t: EventTarget | null) => {
    const el = (t as HTMLElement | null)?.closest?.<HTMLElement>("button, a[href], [tabindex], input, select, textarea") ?? null;
    if (el && !el.closest('[role="dialog"]')) lastFocusOutsideDialog = el;
  };
  // Keyboard users move focus (focusin); pointer users press (pointerdown),
  // which fires even when the window itself doesn't have focus.
  document.addEventListener("focusin", (e) => note(e.target), true);
  document.addEventListener("pointerdown", (e) => note(e.target), true);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal (§13). Focus moves in, is held inside while open (the one intentional
 * trap, §17), and returns to whatever opened it. Escape and the backdrop close.
 */
export function Modal({ open, onClose, title, children, footer, width = 480 }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode;
  /** Actions, right-aligned on the sunken foot bar; the primary goes last. */
  footer?: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers pass a fresh onClose each render; read the latest without
  // re-running the effect (which would move focus about while open).
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const opener = lastFocusOutsideDialog;
    const panel = panelRef.current;
    // React has already focused an autoFocus field; only fall back to the panel.
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closeRef.current();
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (opener?.isConnected) opener.focus(); };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  // Portalled to <body>: an ancestor with a transform (the page transition)
  // would otherwise turn `fixed` into "fixed to that box", and clip the dialog.
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4 fade-in bg-[var(--scrim)]" style={{ zIndex: "var(--z-modal)" }} onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Dialog"}
        tabIndex={-1}
        className="hu-modal pop outline-none max-h-[calc(100dvh-2rem)] flex flex-col"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <div className="hu-modal__head">
            <h2 id={titleId} className="hu-modal__title">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-mt-1.5 -mr-2"><X size={18} /></IconButton>
          </div>
        ) : (
          <div className="flex justify-end px-3 pt-3"><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div>
        )}
        <div className="hu-modal__body overflow-y-auto">{children}</div>
        {footer && <div className="hu-modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---- Toast (§12) -----------------------------------------------------------------

type Tone = "neutral" | "success" | "danger";
const ToastCtx = createContext<(msg: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/**
 * Transient confirmation, above everything (z-toast) so a save confirmation is
 * never buried under a modal. Copy echoes the action in the past tense (§16).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: Tone }[]>([]);
  const push = useCallback((msg: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "danger" ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none" style={{ zIndex: "var(--z-toast)" }} role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "danger" ? "alert" : "status"} className="hu-toast pop">
            {t.tone === "danger" ? <XCircle size={18} className="text-[var(--danger-line)]" aria-hidden="true" />
              : t.tone === "success" ? <CheckCircle2 size={18} className="text-[var(--ok-line)]" aria-hidden="true" />
              : <Info size={18} aria-hidden="true" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---- Alert (§12): persistent, in the flow ---------------------------------------------

const ALERT_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle } as const;

export function Alert({ tone = "info", title, children, action, className = "" }: {
  tone?: keyof typeof ALERT_ICON; title?: ReactNode; children?: ReactNode;
  /** One follow-up, at the end of the row (a link or small button). */
  action?: ReactNode;
  className?: string;
}) {
  const Icon = ALERT_ICON[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={`hu-alert hu-alert--${tone} ${className}`}>
      <Icon size={18} className="hu-alert__icon" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="hu-alert__title">{title}</p>}
        {children && <div className="hu-alert__text">{children}</div>}
      </div>
      {action ? <div className="self-center">{action}</div> : <span />}
    </div>
  );
}

// ---- Field (§10): label, control, hint or error, wired together ------------------------

/**
 * Wraps one control. The label is tied to it, the hint and error are read out
 * with it (aria-describedby), and an error sets aria-invalid (§17). The child
 * is any input-like element; its id, aria-describedby and aria-invalid are set.
 */
export function Field({ label, hint, error, required, children, className = "" }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactElement; className?: string;
}) {
  const auto = useId();
  const child = isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null;
  const id = child?.props.id ?? `f${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const control = child
    ? cloneElement(child as ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": [errId, hintId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : undefined,
        required,
      })
    : children;
  return (
    <div className={`hu-field ${className}`}>
      <label htmlFor={id} className="hu-label">{label}{required && <span className="req" aria-hidden="true">*</span>}</label>
      {control}
      {error ? (
        <p id={errId} className="hu-hint hu-hint--error"><XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}</p>
      ) : hint ? (
        <p id={hintId} className="hu-hint">{hint}</p>
      ) : null}
    </div>
  );
}

// ---- Choice and switch (§10) -----------------------------------------------------------

/** A checkbox or radio with its label as the target. `box` draws the row as a card. */
export function Choice({ type = "checkbox", label, sub, box = false, className = "", ...input }: {
  type?: "checkbox" | "radio"; label: ReactNode; sub?: ReactNode; box?: boolean; className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className={`hu-choice ${box ? "hu-choice--box" : ""} ${className}`}>
      <input type={type} {...input} />
      <span className="hu-choice__text">{label}{sub && <small>{sub}</small>}</span>
    </label>
  );
}

export function Switch({ label, checked, onChange, disabled, name }: {
  label: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; name?: string;
}) {
  return (
    <label className="hu-switch">
      <span className="hu-switch__wrap">
        <input type="checkbox" role="switch" name={name} checked={checked} disabled={disabled} aria-checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="hu-switch__track" aria-hidden="true" />
      </span>
      <span className="text-base">{label}</span>
    </label>
  );
}

// ---- Tabs and segmented control (§14) -----------------------------------------------------

/**
 * Tabs: an underline under the selected one, never a fill (a fill vanished on
 * the light canvas). Items with `href` navigate; the rest call `onSelect`.
 */
export function Tabs<T extends string>({ items, value, onSelect, label, className = "" }: {
  items: { value: T; label: ReactNode; href?: string }[];
  value: T; onSelect?: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`hu-tabs ${className}`}>
      {items.map((it) => {
        const on = it.value === value;
        return it.href ? (
          <Link key={it.value} href={it.href} role="tab" aria-selected={on} className="hu-tab">{it.label}</Link>
        ) : (
          <button key={it.value} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onSelect?.(it.value)} className="hu-tab">
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/** Two to four mutually exclusive views (grid / list, light / dark). */
export function Segmented<T extends string>({ items, value, onChange, label, className = "" }: {
  items: { value: T; label: ReactNode; title?: string }[];
  value: T; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`hu-seg ${className}`}>
      {items.map((it) => (
        <button key={it.value} type="button" role="radio" aria-checked={it.value === value} aria-label={it.title} title={it.title} onClick={() => onChange(it.value)} className="hu-seg__item">
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ---- Tag, spinner, skeleton (§11, §12) ---------------------------------------------------------

/** What something is (a voice word, a pillar). Removable when `onRemove` is set. */
export function Tag({ children, tone = "accent", upper = false, onRemove }: {
  children: ReactNode; tone?: "accent" | "neutral" | "danger"; upper?: boolean; onRemove?: () => void;
}) {
  return (
    <span className={`hu-tag ${tone !== "accent" ? `hu-tag--${tone}` : ""} ${upper ? "hu-tag--upper" : ""}`}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="hu-tag__remove" aria-label={`Remove ${typeof children === "string" ? children : "tag"}`}>
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

export function Spinner({ small = false, label }: { small?: boolean; label?: string }) {
  return <span role={label ? "status" : undefined} aria-label={label} className={`hu-spinner ${small ? "hu-spinner--sm" : ""}`} />;
}

/** Placeholder with the shape of what's loading, so nothing reflows when it lands (§17). */
export function Skeleton({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  return <span role="status" aria-label={label} className={`hu-skel block ${className}`} />;
}

// ---- Menu (§13) -------------------------------------------------------------------------------

/** A list of actions in a popover. Every item clears 44px. */
export function Menu({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return <div role="menu" aria-label={label} className={`hu-menu ${className}`}>{children}</div>;
}

export function MenuItem({ children, onClick, href, danger = false, checked, icon }: {
  children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; checked?: boolean; icon?: ReactNode;
}) {
  const cls = `hu-menu__item ${danger ? "hu-menu__item--danger" : ""}`;
  const inner = <>{icon}<span className="flex-1 truncate">{children}</span>{checked && <Check size={15} aria-hidden="true" />}</>;
  if (href) return <Link role="menuitem" href={href} className={cls}>{inner}</Link>;
  return (
    <button type="button" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export const MenuSeparator = () => <div role="separator" className="hu-menu__sep" />;
