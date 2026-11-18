"use client";

import type { ReactNode } from "react";
import { DockPanel, RightDock } from "@/components/project-panels";

/**
 * The right-hand panel of a canvas step (Figma's "Design" panel). It lives in
 * the page's right slot (components/project-panels): a column beside the
 * canvas from 900px, a sheet over it below that. It never floats on the
 * artboards, and it has no button of its own on the canvas: the editor's top
 * bar (or the canvas tool strip, on the pillar map) opens and closes it.
 *
 * Render it inside a <Stage>, after the <StageCanvas>.
 */
export function StepPanel({ eyebrow, title, children }: {
  /** What sits before the title in the header, e.g. "Step 2 of 3". Omit on workspace pages. */
  eyebrow?: string; title: string; children: ReactNode;
}) {
  return (
    <RightDock label="Details">
      <DockPanel label={eyebrow ? `${eyebrow}: ${title}` : title} title={eyebrow ? `${eyebrow} · ${title}` : title} closeLabel="Close details">
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">{children}</div>
      </DockPanel>
    </RightDock>
  );
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="text-xs font-medium mb-2">{title}</p>
      {children}
    </section>
  );
}
