"use client";

/**
 * Huemen UI kit — "The Atelier" editorial system (AGENTS.md §3.5). Crisp hairline
 * surfaces, oversized display type, mono labels, one hot vermilion. Includes a
 * working Toast + Modal so every action gives feedback.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

export function PageHeader({
  kicker, eyebrow, title, accent, sub, action,
}: { kicker?: string; eyebrow?: string; title: string; accent?: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-10 fade-up">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-3xl">
          {kicker && <p className="kicker mb-4">{kicker}</p>}
          {eyebrow && !kicker && <Eyebrow className="mb-4">{eyebrow}</Eyebrow>}
          <h1 className="headline">{title} {accent && <span className="serif-accent">{accent}</span>}</h1>
          {sub && <p className="mt-5 text-[1rem] text-ink-muted leading-relaxed max-w-xl">{sub}</p>}
        </div>
        {action && <div className="shrink-0 pb-2">{action}</div>}
      </div>
      <div className="mt-7 rule rule-accent" />
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-4 pb-2 border-b border-hairline">
      <h2 className="text-[0.95rem] font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

type BtnProps = {
  children: ReactNode; href?: string;
  variant?: "primary" | "accent" | "secondary" | "ghost";
  size?: "sm" | "md"; icon?: ReactNode; onClick?: () => void; type?: "button" | "submit"; className?: string;
};

export function Button({ children, href, variant = "primary", size = "md", icon, onClick, type = "button", className = "" }: BtnProps) {
  const sizes = size === "sm" ? "px-3.5 py-2 text-[0.8rem]" : "px-5 py-2.5 text-[0.875rem]";
  const variants = {
    primary: "bg-ink text-white hover:bg-accent",
    accent: "bg-accent text-white hover:brightness-105",
    secondary: "bg-paper text-ink border border-line hover:border-ink",
    ghost: "text-ink-muted hover:text-ink",
  }[variant];
  const cls = `inline-flex items-center justify-center gap-2 rounded-[7px] font-medium transition-all duration-150 active:scale-[0.985] ${sizes} ${variants} ${className}`;
  const inner = <>{icon}{children}</>;
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <button type={type} onClick={onClick} className={cls}>{inner}</button>;
}

export function Card({ children, className = "", hover, onClick }: { children?: ReactNode; className?: string; hover?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`bg-paper rounded-[4px] border border-hairline ${hover ? "transition-all duration-200 hover:border-ink hover:shadow-[var(--shadow)] cursor-pointer" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function Pill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 label-mono px-2 py-0.5 rounded-full" style={{ color: color ?? "var(--ink-muted)", background: color ? `color-mix(in srgb, ${color} 12%, transparent)` : "var(--muted-surface)" }}>
      {color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

const STATUS: Record<string, string> = { approved: "#137a43", edited: "#0e0e0e", draft: "#8a8a86", new: "#e11500", converted: "#8a8a86", scheduled: "#0e0e0e" };
export function StatusBadge({ status }: { status: string }) {
  return <span className="label-mono" style={{ color: STATUS[status] ?? STATUS.draft }}>{status}</span>;
}

export function StatTile({ label, value, hint, delta }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; delta?: string }) {
  return (
    <div className="p-5">
      <p className="label-mono">{label}</p>
      <p className="num-display text-[2.4rem] mt-3 leading-none">{value}</p>
      <div className="flex items-center gap-2 mt-2">
        {delta && <span className="label-mono text-accent-ink">{delta}</span>}
        {hint && <span className="label-mono text-ink-faint">{hint}</span>}
      </div>
    </div>
  );
}

export function Meter({ value, max = 100 }: { value: number; max?: number }) {
  return (
    <div className="h-1.5 bg-muted-surface w-full overflow-hidden">
      <div className="h-full bg-accent transition-all duration-700" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}

export function EmptyState({ title, sub, action, icon }: { title: string; sub?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-16 text-center">
      {icon && <div className="mx-auto mb-5 w-12 h-12 border border-hairline flex items-center justify-center text-ink-faint">{icon}</div>}
      <p className="text-lg font-medium">{title}</p>
      {sub && <p className="text-sm text-ink-muted mt-2 max-w-sm mx-auto leading-relaxed">{sub}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </Card>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 fade-in" style={{ background: "rgba(14,14,14,0.5)", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div className="bg-paper border border-hairline rounded-[6px] shadow-[var(--shadow-lg)] w-full max-w-lg pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink transition-colors"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

type Toast = { id: number; msg: string };
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-center gap-2.5 bg-ink text-white rounded-[7px] px-4 py-3 shadow-[var(--shadow-lg)] pop text-sm">
            <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0"><Check size={13} /></span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const inputCls = "w-full bg-paper border border-line rounded-[7px] px-3.5 py-2.5 text-sm placeholder:text-ink-faint focus:outline-none focus:border-ink transition-colors";
