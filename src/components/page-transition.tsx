"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Unhurried route transitions (React <ViewTransition> + the browser View
 * Transitions API). Keyed by path, so a navigation exits the old page and
 * enters the new one, while a same-page refresh (server action, star,
 * rename) does not animate at all (`default="none"`).
 *
 * - level="section": the whole app surface; changes only when you move
 *   between areas (sign-in, workspace home, a project editor, settings).
 * - level="page": the content area inside a persistent chrome (home main,
 *   editor canvas, settings pane); the sidebar/top bar stays put.
 *
 * Timing lives in globals.css (`.page-exit` / `.page-enter`).
 */
export function PageTransition({ level, children }: { level: "section" | "page"; children: ReactNode }) {
  const path = usePathname();
  const key = level === "section" ? sectionOf(path) : path;
  return (
    <ViewTransition key={key} enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}

function sectionOf(path: string): string {
  const project = path.match(/^\/w\/[^/]+\/p\/[^/]+/);
  if (project) return project[0];
  const workspace = path.match(/^\/w\/[^/]+/);
  if (workspace) return workspace[0];
  return `/${path.split("/")[1] ?? ""}`;
}
