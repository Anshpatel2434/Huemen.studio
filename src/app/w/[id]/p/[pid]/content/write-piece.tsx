"use client";

/**
 * The empty Content step: how should this piece get written? (spec file 05, F2)
 *
 *   Ghostwrite  — we draft it in their voice; they edit.
 *   Co-write    — we give the hook and the beats; they write the sentences.
 *   Check mine  — they write it; we check it against their voice.
 *
 * Defaults to the way of working they picked in onboarding, switchable per
 * piece. Every route lands on the same canvas with one item on it.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PenLine, ListTree, ScanText, ArrowUp } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots, Alert } from "@/components/ui";
import { FORMATS } from "@/lib/content/formats";
import type { WorkMode } from "@/lib/voice/types";
import { coWriteAction, ownDraftAction } from "./actions";
import { liveDraftHref } from "@/components/live-draft";

const MODES: { key: WorkMode; label: string; sub: string; icon: typeof PenLine }[] = [
  { key: "ghostwrite", label: "Draft it for me", sub: "A full draft in your voice. You edit.", icon: PenLine },
  { key: "cowrite", label: "Write it together", sub: "A hook and the beats. You write the sentences.", icon: ListTree },
  { key: "check", label: "I'll write it", sub: "You write it. We check it against your voice.", icon: ScanText },
];

export function WritePiece({ tenantId, projectId, pillarId, topic, format: initialFormat, angle, mode: initialMode, confidence }: {
  tenantId: string;
  projectId: string;
  pillarId: string | null;
  topic: string;
  format: string | null;
  angle: string | null;
  mode: WorkMode;
  confidence: { score: number; missing: string[] } | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<WorkMode>(initialMode);
  const [format, setFormat] = useState(initialFormat ?? FORMATS[0].key);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The topic is the prompt: it starts as the piece's title and can be sharpened here.
  const [brief, setBrief] = useState(topic);

  const go = () => {
    const t = brief.trim() || topic;
    // Ghostwrite is written live on the canvas (components/live-draft).
    if (mode === "ghostwrite") return router.push(liveDraftHref(`/w/${tenantId}/p/${projectId}`, { format, topic: t, pillarId }));
    start(async () => {
      setError(null);
      const r =
        mode === "cowrite" ? await coWriteAction(tenantId, projectId, { format, topic: t, angle })
        : await ownDraftAction(tenantId, projectId, { format, topic: t, text });
      if (!r.ok) return setError(r.error);
      router.replace(`/w/${tenantId}/p/${projectId}/content?item=${r.id}`);
      router.refresh();
    });
  };
  const disabled = pending || (mode === "check" ? !text.trim() : !brief.trim());
  const cta = mode === "ghostwrite" ? "Draft it" : mode === "cowrite" ? "Give me the outline" : "Save and check";

  /*
   * Open on the canvas, like a design tool's new file: what this piece is,
   * how to write it, and one composer to say so. No card floating in space.
   */
  return (
    <div className="absolute inset-0 canvas-dots overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-5 sm:px-10 py-12">
        <div className="w-full max-w-[860px] flex flex-col gap-7">
          <div className="text-center flex flex-col items-center gap-2">
            <p className="label-mono text-ink-faint">New piece · {FORMATS.find((f) => f.key === format)?.label ?? "Content"}</p>
            <h1 className="text-display leading-[1.05] max-w-[22ch]">{topic}</h1>
            {angle && <p className="text-ink-muted max-w-xl">{angle}</p>}
            {confidence && confidence.score < 70 && (
              <p className="inline-flex items-center gap-2 text-sm text-warn mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-warn" aria-hidden="true" />
                Your core is {confidence.score}% confident; drafts get closer to you as it reads more of your writing.
              </p>
            )}
          </div>

          <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="How to write this piece">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={mode === m.key}
                onClick={() => setMode(m.key)}
                title={m.sub}
                className={`inline-flex items-center gap-2 min-h-11 px-4 rounded-full border text-sm transition-colors ${mode === m.key ? "bg-ink text-on-ink border-ink" : "bg-paper border-line hover:border-line-strong"}`}
              >
                <m.icon size={15} aria-hidden="true" /> {m.label}
              </button>
            ))}
          </div>

          <div className="hu-composer">
            {mode === "check" ? (
              <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste or write your piece. The first line is the hook." aria-label="Your piece" autoFocus />
            ) : (
              <textarea
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !disabled) go(); }}
                aria-label="What this piece is about"
                placeholder="What is this piece about?"
              />
            )}
            <div className="hu-composer__bar">
              <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Format" className="shrink-0">
                {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <span className="flex-1 text-xs text-ink-faint hidden sm:block">{MODES.find((m) => m.key === mode)?.sub}</span>
              <button type="button" disabled={disabled} onClick={go} className={btnClass("primary", "sm")}>
                {pending ? <><AgentDots /> {mode === "check" ? "Checking" : "Writing"}</> : <>{cta} <ArrowUp size={15} aria-hidden="true" /></>}
              </button>
            </div>
          </div>

          {error && <Alert tone="danger">{error}</Alert>}
          <p className="text-center text-xs text-ink-faint">Your voice, pillars and guardrails go in automatically. There is nothing to brief.</p>
        </div>
      </div>
    </div>
  );
}
