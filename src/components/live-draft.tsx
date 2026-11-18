"use client";

/**
 * A draft written live onto the canvas (brief §07: stream what the user waits
 * on). Mounted once on the Content step. Every way of starting a ghostwritten
 * draft (the empty step, the Draft dialog, the Add panel) navigates to
 * `content?write=<format>&topic=…&pillar=…&n=<nonce>`; this layer reads that,
 * strips it from the URL, and streams from /content/stream. Each version gets
 * its own artboard and fills in as it is written. When the piece is saved the
 * canvas opens on it; a failure keeps the input and offers to try again.
 *
 * LEAVING MID-DRAFT. The server finishes and saves a draft once it has
 * started, whoever is still watching (content/stream/route). So reloading,
 * closing the tab and moving to another page all end the same way: the whole
 * draft, with its topic, is on the piece. This layer remembers (for this tab)
 * that a draft was under way, and on the next visit to the step says so:
 * nothing is lost and nothing appears unexplained. The one way to throw a
 * draft away is the Stop button, which says it does, keeps listening, and
 * deletes the piece the moment the server reports it saved.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { AgentDots, Alert, IconButton, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { formatByKey } from "@/lib/content/formats";
import { deleteContentAction } from "@/app/w/[id]/p/[pid]/content/actions";

/** "A draft is being written for this piece", kept for the tab so a reload or a return can say what happened. */
const underWayKey = (projectId: string) => `huemen:live-draft:${projectId}`;
const noteUnderWay = (projectId: string, topic: string) => {
  try { sessionStorage.setItem(underWayKey(projectId), JSON.stringify({ topic, at: Date.now() })); } catch { /* private mode: the draft is still saved */ }
};
const clearUnderWay = (projectId: string) => {
  try { sessionStorage.removeItem(underWayKey(projectId)); } catch { /* nothing to clear */ }
};
const readUnderWay = (projectId: string): { topic: string; at: number } | null => {
  try {
    const v = JSON.parse(sessionStorage.getItem(underWayKey(projectId)) ?? "null") as { topic?: unknown; at?: unknown } | null;
    return v && typeof v.at === "number" ? { topic: String(v.topic ?? ""), at: v.at } : null;
  } catch { return null; }
};

const SEP = /^\s*=====\s*$/m;
type Input = { format: string; topic: string; pillarId: string | null };
type State = { phase: "idle" } | { phase: "writing" | "saving"; input: Input; text: string } | { phase: "error"; input: Input; text: string; message: string };

/** Started keys survive React's dev double-effect, so one click is one draft. */
const started = new Set<string>();

/** The link that starts a live draft. Used by every entry point. */
export function liveDraftHref(base: string, input: Input): string {
  const q = new URLSearchParams({ write: input.format, topic: input.topic, n: String(Date.now()) });
  if (input.pillarId) q.set("pillar", input.pillarId);
  return `${base}/content?${q.toString()}`;
}

/** Split what has arrived so far into versions, then into hook / body / ask. */
function partsOf(text: string) {
  return text.split(SEP).map((v) => {
    const lines = v.replace(/^\n+/, "").split("\n");
    const hook = lines.shift() ?? "";
    let rest = lines.join("\n");
    let cta = "";
    const m = rest.match(/\n\s*(?:CTA:|→)\s*([^\n]*)$/i);
    if (m) {
      cta = m[1];
      rest = rest.slice(0, m.index);
    }
    return { hook, body: rest.trim(), cta };
  });
}

export function LiveDraftLayer({ tenantId, projectId, brandName }: { tenantId: string; projectId: string; brandName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [state, setState] = useState<State>({ phase: "idle" });
  const toast = useToast();
  const abort = useRef<AbortController | null>(null);
  /** The draft on screen. `discard` is set by Stop: that run keeps listening and deletes what gets saved. */
  const live = useRef<{ discard: boolean } | null>(null);

  const run = useCallback(async (input: Input) => {
    // A stopped draft is left to finish (so it can be deleted); any other is replaced.
    if (!live.current?.discard) abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const me = { discard: false };
    live.current = me;
    noteUnderWay(projectId, input.topic);
    setState({ phase: "writing", input, text: "" });
    let text = "";
    try {
      const res = await fetch(`/w/${tenantId}/p/${projectId}/content/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error("That didn't start. Try again.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as
            | { t: "d"; v: string }
            | { t: "r"; v: string }
            | { t: "notice"; message: string }
            | { t: "saved"; id: string }
            | { t: "error"; message: string };
          if (ev.t === "notice") {
            toast(ev.message);
            continue;
          }
          if (ev.t === "d" || ev.t === "r") {
            // "r" replaces the whole draft: it was written again because the first try came back in the wrong shape.
            text = ev.t === "d" ? text + ev.v : ev.v;
            if (!me.discard) setState({ phase: "writing", input, text });
          } else if (ev.t === "saved") {
            if (live.current === me) clearUnderWay(projectId);
            if (me.discard) {
              // Stopped: the server saved it anyway (it always finishes), so take it back out.
              await deleteContentAction(tenantId, projectId, ev.id).catch(() => undefined);
              router.refresh();
              return;
            }
            setState({ phase: "saving", input, text });
            router.replace(`${pathname}?item=${ev.id}`, { scroll: false });
            router.refresh();
            // Let the board render the saved piece before the live layer goes.
            setTimeout(() => setState({ phase: "idle" }), 900);
            return;
          } else {
            // Nothing was saved, so there is nothing to explain on the next visit.
            if (live.current === me) clearUnderWay(projectId);
            if (!me.discard) setState({ phase: "error", input, text, message: ev.message });
            return;
          }
        }
      }
      if (live.current === me) clearUnderWay(projectId);
      if (!me.discard) setState({ phase: "error", input, text, message: "The draft stopped before it finished. Try again." });
    } catch (e) {
      // Aborted by leaving the page: the server carries on and saves it; the note stays for the return.
      if (ac.signal.aborted || me.discard) return;
      clearUnderWay(projectId);
      setState({ phase: "error", input, text, message: e instanceof Error && e.message ? e.message : "That didn't go through. Try again." });
    }
  }, [tenantId, projectId, pathname, router, toast]);

  // Back on the step (a reload, or a return from another page) after leaving
  // mid-draft: say what happened to it, and bring the saved piece in.
  useEffect(() => {
    const t = setTimeout(() => {
      const left = readUnderWay(projectId);
      if (!left || live.current) return;
      clearUnderWay(projectId);
      // Older than this and it finished long ago: it is simply on the board.
      if (Date.now() - left.at > 5 * 60_000) return;
      toast(`You left while a draft${left.topic ? ` on "${left.topic.slice(0, 60)}${left.topic.length > 60 ? "…" : ""}"` : ""} was being written. It was not thrown away: it finishes on its own and is saved to this piece.`);
      // It may still be writing: look again a few times so it appears without a reload.
      [3000, 9000, 20000, 40000].forEach((ms) => setTimeout(() => router.refresh(), ms));
    }, 50);
    return () => clearTimeout(t);
  }, [projectId, router, toast]);

  /** Stop: the draft on screen is thrown away. Says so, because leaving the page does the opposite. */
  const stop = () => {
    // Already saved and opening: there is nothing left to stop.
    if (state.phase !== "writing") return setState({ phase: "idle" });
    if (live.current) live.current.discard = true;
    clearUnderWay(projectId);
    setState({ phase: "idle" });
    toast("Stopped. That draft won't be kept.");
  };

  // Start from the URL, once per nonce, then take the request out of the URL.
  // The effect only schedules; the start runs on the next tick, so React's
  // dev double-effect cancels the first schedule and the second one runs.
  const write = sp.get("write");
  const nonce = sp.get("n") ?? "";
  const topic = sp.get("topic") ?? "";
  const pillar = sp.get("pillar");
  useEffect(() => {
    if (!write) return;
    const key = `${projectId}:${nonce}:${write}`;
    const t = setTimeout(() => {
      if (started.has(key)) return;
      started.add(key);
      void run({ format: write, topic, pillarId: pillar });
      router.replace(pathname, { scroll: false });
    }, 0);
    return () => clearTimeout(t);
  }, [write, nonce, topic, pillar, projectId, pathname, router, run]);

  // Leaving the step lets go of the stream (the server finishes the draft on
  // its own). A stopped draft keeps its listener, so it can still be deleted.
  useEffect(() => () => { if (!live.current?.discard) abort.current?.abort(); }, []);

  if (state.phase === "idle") return null;
  const fmt = formatByKey(state.input.format);
  const versions = partsOf(state.text);
  const writing = state.phase === "writing";

  return (
    <div className={`absolute inset-0 z-40 canvas-dots overflow-auto ${state.phase === "saving" ? "fade-out" : "fade-in"}`} aria-live="polite" aria-busy={writing}>
      <div className="min-h-full flex flex-col items-center justify-center gap-6 p-8">
        <div className="flex items-center gap-3">
          <span className="label-mono text-ink-faint">{fmt.label}{state.input.topic ? ` · ${state.input.topic}` : ""}</span>
          {writing && <span className="inline-flex items-center gap-2 text-sm text-ink-muted"><AgentDots /> Writing in your voice</span>}
          {state.phase === "saving" && <span className="text-sm text-ink-muted">Saved. Opening it…</span>}
          {state.phase !== "error" && (
            <IconButton label="Stop and discard this draft" onClick={stop}><X size={16} /></IconButton>
          )}
        </div>
        <div className="flex flex-wrap gap-8 justify-center items-start">
          {versions.map((v, i) => {
            const last = i === versions.length - 1;
            return (
              <div key={i} className="w-[min(440px,90vw)] fade-up">
                <p className="text-xs font-medium text-ink-muted mb-2">Version {i + 1}</p>
                <div className="theme-light bg-paper rounded-xs ring-1 ring-[var(--hairline)] shadow-[var(--shadow)] p-5 min-h-48">
                  <p className="text-[0.85rem] font-semibold">{brandName}</p>
                  <div className="wf-bar h-2 w-32 mt-1.5" />
                  <p className="mt-3.5 text-[0.95rem] font-semibold leading-snug">{v.hook}{last && writing && !v.body && <Caret />}</p>
                  {v.body && <p className="mt-2 text-[0.85rem] leading-relaxed text-ink/85 whitespace-pre-wrap">{v.body}{last && writing && !v.cta && <Caret />}</p>}
                  {v.cta && <p className="mt-3 text-[0.85rem] font-medium">→ {v.cta}{last && writing && <Caret />}</p>}
                </div>
              </div>
            );
          })}
        </div>
        {state.phase === "error" && (
          <div className="w-[min(560px,90vw)]">
            <Alert
              tone="danger"
              title="The draft didn't finish"
              action={
                <span className="flex gap-2">
                  <button type="button" onClick={() => setState({ phase: "idle" })} className={btnClass("ghost", "sm")}>Close</button>
                  <button type="button" onClick={() => run(state.input)} className={btnClass("primary", "sm")}><RotateCcw size={14} aria-hidden="true" /> Try again</button>
                </span>
              }
            >
              {state.message} Your topic and format are kept; nothing was saved.
            </Alert>
          </div>
        )}
      </div>
    </div>
  );
}

function Caret() {
  return <span aria-hidden="true" className="inline-block w-[2px] h-[1em] align-[-0.15em] ml-0.5 bg-current animate-pulse" />;
}
