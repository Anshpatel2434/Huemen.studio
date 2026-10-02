"use client";

/**
 * The Check surface (design system §15.3 and §15.4).
 *
 * The band decides what leads, never whether you may publish:
 *   on brand  → findings collapsed, copy is the obvious next step
 *   drifting  → findings open, each with a fix you can apply in place
 *   off brand → "Rewrite in my voice" becomes the primary action
 */
import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, Check as CheckIcon, Copy, Wand2 } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";
import { ScoreMeter, Findings, type Finding } from "@/components/composites";
import { PLATFORM_RULES } from "@/lib/voice/platforms";
import type { CheckOutcome } from "@/lib/data/check";
import type { JudgeResult } from "@/lib/ai/tasks";
import type { IssueSeverity } from "@/lib/voice/check";
import { checkAction, judgeAction, rewriteAction } from "./actions";

const BAND = { on_brand: "on", drifting: "drift", off_brand: "off" } as const;
const SEVERITY: Record<IssueSeverity, Finding["verdict"]> = { error: "off", warning: "drift", note: "drift" };

export function CheckDesk({ tenantId, platforms, confidence }: {
  tenantId: string;
  platforms: string[];
  confidence: { score: number; missing: string[] } | null;
}) {
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState<string>(platforms[0] ?? "linkedin");
  const [result, setResult] = useState<CheckOutcome | null>(null);
  const [findings, setFindings] = useState<JudgeResult["findings"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, startCheck] = useTransition();
  const [judging, startJudge] = useTransition();
  const [rewriting, startRewrite] = useTransition();
  const [checkedText, setCheckedText] = useState("");

  const run = (draft: string) => {
    setError(null);
    setFindings(null);
    setCheckedText(draft);
    startCheck(async () => {
      const r = await checkAction(tenantId, draft, platform);
      if (!r.ok) return setError(r.error);
      setResult(r.value);
    });
    // The line findings are a model call: started alongside, shown when ready.
    startJudge(async () => {
      const r = await judgeAction(tenantId, draft, platform);
      if (!r.ok) return setError(r.error);
      setFindings(r.value);
    });
  };

  const applyFix = (line: string, fix: string) => {
    const next = text.includes(line) ? text.replace(line, fix) : text;
    setText(next);
    setFindings((f) => f?.filter((x) => x.line !== line) ?? null);
  };

  const rewrite = () => startRewrite(async () => {
    setError(null);
    const r = await rewriteAction(tenantId, text, platform);
    if (!r.ok) return setError(r.error);
    setText(r.value);
    run(r.value);
  });

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the textarea is selectable */ }
  };

  const band = result ? BAND[result.band] : null;
  const stale = result && checkedText !== text;
  const rule = PLATFORM_RULES[platform];
  const codeFindings: Finding[] = (result?.issues ?? []).map((i) => ({
    verdict: SEVERITY[i.severity],
    text: i.message,
    why: i.excerpt ? <span className="italic">“{i.excerpt}”</span> : undefined,
  }));

  const lineFindings = (findings ?? []).filter((f) => f.verdict !== "on");

  const findingList = (
    <div className="flex flex-col gap-3">
      {codeFindings.length > 0 && <Findings items={codeFindings} />}
      {judging && <p className="text-[0.85rem] text-ink-muted flex items-center gap-2"><AgentDots /> Reading it line by line</p>}
      {lineFindings.map((f) => (
        <div key={f.line} className="border border-hairline rounded-[10px] p-3.5 flex flex-col gap-2">
          <p className="text-[0.85rem] italic">“{f.line}”</p>
          <p className="text-[0.8rem] text-ink-muted"><span className="font-medium text-ink">{f.attribute}.</span> {f.why}</p>
          {f.fix && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[0.85rem] flex-1 min-w-0"><span className="text-ink-faint">In your voice: </span>{f.fix}</p>
              <button type="button" onClick={() => applyFix(f.line, f.fix)} className={btnClass("secondary", "sm")}>Apply</button>
            </div>
          )}
        </div>
      ))}
      {!judging && findings && codeFindings.length === 0 && lineFindings.length === 0 && (
        <p className="text-[0.85rem] text-ink-muted">Nothing to change.</p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {confidence && confidence.score < 70 && (
        <p className="text-[0.85rem] text-warn bg-warn-soft rounded-[8px] px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Your core is {confidence.score}% confident, so this check is still learning you.{confidence.missing[0] ? ` ${confidence.missing[0]}.` : ""} <Link href={`/w/${tenantId}/onboarding?step=1`} className="underline underline-offset-2">Add writing</Link></span>
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label htmlFor="check-text" className="text-[0.88rem] font-medium">Your draft</label>
          <label className="flex items-center gap-2 text-[0.82rem] text-ink-muted">
            For
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="field !w-auto min-h-11">
              {Object.values(PLATFORM_RULES).map((p) => (
                <option key={p.key} value={p.key}>{p.label}{platforms.includes(p.key) ? "" : " (not set up)"}</option>
              ))}
            </select>
          </label>
        </div>
        <textarea id="check-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} className="field text-[0.95rem] leading-relaxed" placeholder="Paste a draft." />
        <div className="flex flex-wrap items-center gap-3 text-[0.78rem] text-ink-faint tabular-nums">
          <span>{text.length.toLocaleString()} characters</span>
          {rule?.maxChars && <span>· limit {rule.maxChars.toLocaleString()}</span>}
          {rule?.visibleChars && <span>· {rule.visibleChars} show before “see more”</span>}
        </div>
        {/* §15.3: the band picks the one primary action. On brand: take it and
            go (copy). Off brand: the rewrite. Drifting: fix, then check again. */}
        <div className="flex flex-wrap gap-2">
          {band === "on" && !stale && (
            <button type="button" onClick={copy} className={btnClass("primary")}>
              {copied ? <CheckIcon size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? "Copied" : "Copy it"}
            </button>
          )}
          <button type="button" disabled={!text.trim() || checking} onClick={() => run(text)} className={btnClass(band === "off" || (band === "on" && !stale) ? "secondary" : "primary")}>
            {checking ? <AgentDots /> : null} {result ? "Check again" : "Check it"}
          </button>
          {band === "off" && (
            <button type="button" disabled={rewriting} onClick={rewrite} className={btnClass("primary")}>
              {rewriting ? <AgentDots /> : <Wand2 size={15} aria-hidden="true" />} Rewrite in my voice
            </button>
          )}
          {result && !(band === "on" && !stale) && (
            <button type="button" onClick={copy} className={btnClass("ghost")}>
              {copied ? <CheckIcon size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>

      {error && <p role="alert" className="text-[0.85rem] text-danger bg-danger-soft rounded-[8px] px-3 py-2.5">{error}</p>}

      {result && band && (
        <section aria-live="polite" className={`bg-paper border border-hairline rounded-[12px] p-5 flex flex-col gap-4 ${stale ? "opacity-60" : ""}`}>
          <ScoreMeter score={result.score} band={band} />
          <p className="text-[0.8rem] text-ink-muted">
            Measured against {result.corpusPieces} {result.corpusPieces === 1 ? "piece" : "pieces"} of your writing{rule ? `, for ${rule.label}` : ""}.
            {stale && " You've edited since. Check again for a fresh score."}
          </p>
          {band === "on" ? (
            <details>
              <summary className="cursor-pointer min-h-11 flex items-center text-[0.85rem] text-ink-muted">Details</summary>
              {findingList}
            </details>
          ) : (
            findingList
          )}
        </section>
      )}
    </div>
  );
}
