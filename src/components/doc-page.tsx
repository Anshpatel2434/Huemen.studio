import type { ReactNode } from "react";

/** Scrollable document layout for non-canvas screens inside a workspace. */
export function DocPage({ eyebrow, title, accent, sub, action, children, width = 880 }: {
  eyebrow: string; title: string; accent?: string; sub?: string; action?: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto px-8 py-10" style={{ maxWidth: width }}>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="label-mono eyebrow">{eyebrow}</p>
            <h1 className="text-[1.9rem] mt-1.5">{title} {accent && <span className="serif-accent">{accent}</span>}</h1>
            {sub && <p className="text-ink-muted text-[0.9rem] mt-2 max-w-xl">{sub}</p>}
          </div>
          {action}
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
