import type { ReactNode } from "react";
import { BackButton } from "@/components/back-button";

/** Scrollable document layout for non-canvas screens inside a workspace. */
/**
 * The page uses the width it is given (`.page`), like a design tool, rather
 * than a narrow column marooned in the middle. `width` is kept for callers
 * and ignored.
 */
export function DocPage({ eyebrow, title, accent, sub, action, children, back, backLabel }: {
  eyebrow: string; title: string; accent?: string; sub?: string; action?: ReactNode; children: ReactNode; width?: number;
  back?: string; backLabel?: string;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="page py-10">
        {back && <div className="mb-5"><BackButton href={back} label={backLabel ?? "Back"} /></div>}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="label-mono eyebrow">{eyebrow}</p>
            <h1 className="text-3xl mt-1.5">{title} {accent && <span className="serif-accent">{accent}</span>}</h1>
            {sub && <p className="text-ink-muted text-base mt-2 max-w-2xl">{sub}</p>}
          </div>
          {action}
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
