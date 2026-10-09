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
import { PenLine, ListTree, ScanText, AlertTriangle } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";
import { FORMATS } from "@/lib/content/formats";
import type { WorkMode } from "@/lib/voice/types";
import { coWriteAction, ghostwriteAction, ownDraftAction } from "./actions";

const MODES: { key: WorkMode; label: string; sub: string; icon: typeof PenLine }[] = [
  { key: "ghostwrite", label: "Draft it for me", sub: "A full draft in your voice. You edit.", icon: PenLine },
  { key: "cowrite", label: "Write it together", sub: "A hook and the beats. You write the sentences.", icon: ListTree },
  { key: "check", label: "I'll write it", sub: "You write it. We check it against your voice.", icon: ScanText },
];

export function WritePiece({ tenantId, projectId, topic, format: initialFormat, angle, mode: initialMode, confidence }: {
  tenantId: string;
  projectId: string;
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

  const go = () => start(async () => {
    setError(null);
    const r =
      mode === "ghostwrite" ? await ghostwriteAction(tenantId, projectId, { format, topic })
      : mode === "cowrite" ? await coWriteAction(tenantId, projectId, { format, topic, angle })
      : await ownDraftAction(tenantId, projectId, { format, topic, text });
    if (!r.ok) return setError(r.error);
    router.replace(`/w/${tenantId}/p/${projectId}/content?item=${r.id}`);
    router.refresh();
  });

  return (
    <div className="absolute inset-0 canvas-dots overflow-y-auto flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className="bg-paper border border-hairline rounded-md max-w-xl w-full shadow-[var(--shadow)] p-6 flex flex-col gap-5">
        <div>
          <p className="label-mono text-ink-faint">Content</p>
          <h2 className="text-lg mt-1.5 leading-snug">{topic}</h2>
          {angle && <p className="text-sm text-ink-muted mt-1">{angle}</p>}
        </div>

        {confidence && confidence.score < 70 && (
          <p className="text-sm text-warn bg-warn-soft rounded-sm px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            Your core is {confidence.score}% confident, so this will be closer to you once it has more of your writing.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="How to write this piece">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              onClick={() => setMode(m.key)}
              className={`text-left rounded-md border p-3 min-h-11 flex flex-col gap-1 transition-colors ${mode === m.key ? "border-ink bg-field" : "border-hairline hover:border-line"}`}
            >
              <m.icon size={16} aria-hidden="true" />
              <span className="text-sm font-medium">{m.label}</span>
              <span className="text-xs text-ink-muted">{m.sub}</span>
            </button>
          ))}
        </div>

        <label className="block">
          <span className="block text-sm font-medium mb-1">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="field min-h-11">
            {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>

        {mode === "check" && (
          <label className="block">
            <span className="block text-sm font-medium mb-1">Your piece. The first line is the hook.</span>
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} className="field leading-relaxed" />
          </label>
        )}

        {error && <p role="alert" className="text-sm text-danger bg-danger-soft rounded-sm px-3 py-2.5">{error}</p>}

        <button type="button" disabled={pending || (mode === "check" && !text.trim())} onClick={go} className={`${btnClass("primary")} self-start`}>
          {pending ? <><AgentDots /> {mode === "check" ? "Checking" : "Writing in your voice"}</> : mode === "ghostwrite" ? "Draft it" : mode === "cowrite" ? "Give me the outline" : "Save and check"}
        </button>
      </div>
    </div>
  );
}
