"use client";

/**
 * A draft written live onto the canvas (brief §07: stream what the user waits
 * on). Mounted once on the Content step. Every way of starting a ghostwritten
 * draft (the empty step, the Draft dialog, the Add panel) navigates to
 * `content?write=<format>&topic=…&pillar=…&n=<nonce>`; this layer reads that,
 * strips it from the URL, and streams from /content/stream. Each version gets
 * its own artboard and fills in as it is written. When the piece is saved the
 * canvas opens on it; a failure keeps the input and offers to try again.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { AgentDots, Alert, IconButton } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { formatByKey } from "@/lib/content/formats";

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
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (input: Input) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
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
          const ev = JSON.parse(line) as { t: "d"; v: string } | { t: "saved"; id: string } | { t: "error"; message: string };
          if (ev.t === "d") {
            text += ev.v;
            setState({ phase: "writing", input, text });
          } else if (ev.t === "saved") {
            setState({ phase: "saving", input, text });
            router.replace(`${pathname}?item=${ev.id}`, { scroll: false });
            router.refresh();
            // Let the board render the saved piece before the live layer goes.
            setTimeout(() => setState({ phase: "idle" }), 900);
            return;
          } else {
            setState({ phase: "error", input, text, message: ev.message });
            return;
          }
        }
      }
      setState({ phase: "error", input, text, message: "The draft stopped before it finished. Try again." });
    } catch (e) {
      if (ac.signal.aborted) return;
      setState({ phase: "error", input, text, message: e instanceof Error && e.message ? e.message : "That didn't go through. Try again." });
    }
  }, [tenantId, projectId, pathname, router]);

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

  useEffect(() => () => abort.current?.abort(), []);

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
            <IconButton label="Stop writing" onClick={() => { abort.current?.abort(); setState({ phase: "idle" }); }}><X size={16} /></IconButton>
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
