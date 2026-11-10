"use client";

import { useState } from "react";
import { saveCanvasAction } from "@/app/settings/actions";
import { CANVAS_BGS, CANVAS_LABEL, type CanvasBg } from "@/lib/canvas-bg";

/**
 * Settings → Canvas: the background behind every canvas (Content, Visual, the
 * empty piece). Each card is a live swatch of the pattern; picking one swaps
 * `<html data-canvas>` at once and saves it in the background.
 */
export function CanvasPicker({ initial }: { initial: CanvasBg }) {
  const [pick, setPick] = useState<CanvasBg>(initial);
  const choose = (v: CanvasBg) => {
    setPick(v);
    document.documentElement.setAttribute("data-canvas", v);
    void saveCanvasAction(v);
  };
  return (
    <div role="radiogroup" aria-label="Canvas background" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {CANVAS_BGS.map((v) => {
        const on = pick === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(v)}
            className={`w-full rounded-md border p-3 text-left transition-colors ${on ? "border-ink ring-1 ring-ink" : "border-hairline hover:border-line"}`}
          >
            <span data-canvas={v} className="canvas-dots relative flex items-center justify-center h-20 rounded-sm mb-2.5 border border-hairline overflow-hidden">
              {/* A miniature artboard, so the pattern reads as a canvas behind work. */}
              <span className="w-10 h-12 rounded-[3px] bg-paper border border-hairline shadow-[var(--shadow-sm)]" aria-hidden="true" />
            </span>
            <span className="block text-sm font-medium">{CANVAS_LABEL[v].label}</span>
            <span className="block text-xs text-ink-faint mt-0.5">{CANVAS_LABEL[v].hint}</span>
          </button>
        );
      })}
    </div>
  );
}
