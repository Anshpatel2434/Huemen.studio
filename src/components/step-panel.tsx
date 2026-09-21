import type { ReactNode } from "react";

/** Right-hand inspector column (Figma "Design" panel), used by canvas steps. */
export function StepPanel({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <aside className="absolute top-0 right-0 bottom-0 w-[280px] bg-paper border-l border-hairline flex flex-col z-10">
      <div className="h-10 shrink-0 flex items-center px-3 border-b border-hairline">
        <span className="label-mono text-ink-faint">Step {step} · {title}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">{children}</div>
    </aside>
  );
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="text-[0.75rem] font-medium mb-2">{title}</p>
      {children}
    </section>
  );
}
