"use client";

/**
 * "Building your core" that survives a refresh (design system §15.2).
 *
 * The scan's state is stored on the pack, so a reloaded page still knows it is
 * running. While it runs, this re-reads the page every few seconds; when it
 * stops running it says so once, with a toast.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { AgentDots, useToast } from "@/components/ui";
import { CORE_STATE_LABEL, type CoreState } from "@/lib/voice/lifecycle";

const POLL_MS = 2500;

export function CoreWatcher({ state, pieces }: { state: CoreState; pieces: number }) {
  const router = useRouter();
  const toast = useToast();
  const wasRunning = useRef(false);
  const running = state === "ingesting" || state === "learning";

  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      const t = setInterval(() => router.refresh(), POLL_MS);
      return () => clearInterval(t);
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      toast(`Your core is ready. ${pieces} ${pieces === 1 ? "piece" : "pieces"} measured.`);
    }
  }, [running, pieces, router, toast]);

  if (!running) return null;
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2 bg-field rounded-md px-4 py-3">
      <p className="text-sm font-medium flex items-center gap-2"><AgentDots /> {CORE_STATE_LABEL[state]}</p>
      <div className="h-1.5 rounded-full bg-paper overflow-hidden" role="progressbar" aria-label={CORE_STATE_LABEL[state]}>
        <div className="h-full w-full bg-ink animate-pulse" />
      </div>
      <p className="text-xs text-ink-muted">You can leave this page. It keeps going, and it&apos;ll be here when you come back.</p>
    </div>
  );
}
