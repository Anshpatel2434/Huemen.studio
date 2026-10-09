"use client";

/**
 * The Check surface, laid out as the composer (design system §15.7): the
 * draft on the left with its one primary action, and beside it the core whose
 * voice it is measured against, the score (§15.3) and the findings (§15.4),
 * so the verdict never scrolls away from the words it is about.
 *
 * The band decides what leads, never whether you may publish:
 *   on brand  → findings collapsed, copy is the obvious next step
 *   drifting  → findings open, each with a fix you can apply in place
 *   off brand → "Rewrite in my voice" becomes the primary action
 */
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { Check as CheckIcon, Copy, ScanText, Wand2 } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots, Alert } from "@/components/ui";
import { CoreAside, ScoreMeter, Findings, type Finding } from "@/components/composites";
import { PLATFORM_RULES } from "@/lib/voice/platforms";
import type { CheckOutcome } from "@/lib/data/check";
import type { JudgeResult } from "@/lib/ai/tasks";
import type { IssueSeverity } from "@/lib/voice/check";
import { checkAction, judgeAction, rewriteAction } from "./actions";

const BAND = { on_brand: "on", drifting: "drift", off_brand: "off" } as const;
const SEVERITY: Record<IssueSeverity, Finding["verdict"]> = { error: "off", warning: "drift", note: "drift" };

export function CheckDesk({ tenantId, platforms, core, intro }: {
  tenantId: string;
  platforms: string[];
  /** The core the draft is measured against; null before there is one. */
  core: { name: string; seed: string; confidence: number; missing: string[]; attributes: string[]; trained: boolean } | null;
  /** The page heading, above the draft. */
  intro: ReactNode;
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
      {judging && <p className="text-sm text-ink-muted flex items-center gap-2"><AgentDots /> Reading it line by line</p>}
      {lineFindings.map((f) => (
        <div key={f.line} className="border border-hairline rounded-md p-3.5 flex flex-col gap-2">
          <p className="text-sm italic">“{f.line}”</p>
          <p className="text-sm text-ink-muted"><span className="font-medium text-ink">{f.attribute}.</span> {f.why}</p>
          {f.fix && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm flex-1 min-w-0"><span className="text-ink-faint">In your voice: </span>{f.fix}</p>
              <button type="button" onClick={() => applyFix(f.line, f.fix)} className={btnClass("secondary", "sm")}>Apply</button>
            </div>
          )}
        </div>
      ))}
      {!judging && findings && codeFindings.length === 0 && lineFindings.length === 0 && (
        <p className="text-sm text-ink-muted">Nothing to change.</p>
      )}
    </div>
  );

  const lowConfidence = core && core.confidence < 70 && (
    <Alert tone="warning" title={`Your core is ${core.confidence}% confident`}>
      This check is still learning you.{core.missing[0] ? ` ${core.missing[0]}.` : ""} <Link href={`/w/${tenantId}/onboarding?step=1`}>Add writing</Link>
    </Alert>
  );

  return (
    <div className="absolute inset-0 overflow-y-auto min-[1100px]:overflow-hidden min-[1100px]:grid min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
      {/* The draft */}
      <div className="min-[1100px]:overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-5 sm:px-8 py-8 flex flex-col gap-5">
          {intro}
          <div className="bg-paper border border-hairline rounded-md flex flex-col focus-within:border-line-strong transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-hairline">
              <label htmlFor="check-text" className="text-sm font-semibold">Your draft</label>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                For
                <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="field !w-auto min-h-11">
                  {Object.values(PLATFORM_RULES).map((p) => (
                    <option key={p.key} value={p.key}>{p.label}{platforms.includes(p.key) ? "" : " (not set up)"}</option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              id="check-text"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full resize-y bg-transparent !outline-none px-5 py-4 text-lg leading-relaxed min-h-[260px] placeholder:text-ink-faint"
              placeholder="Paste a draft: one from here, one you wrote yourself, or one someone wrote for you."
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 border-t border-hairline">
              <p className="flex-1 basis-[34ch] flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint tabular-nums font-mono">
                <span>{text.length.toLocaleString()} characters</span>
                {rule?.maxChars && <span>· limit {rule.maxChars.toLocaleString()}</span>}
                {rule?.visibleChars && <span>· {rule.visibleChars} show before “see more”</span>}
              </p>
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
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </div>

      {/* Whose voice, and the verdict */}
      <aside aria-label="Your core and the verdict" className="border-t min-[1100px]:border-t-0 min-[1100px]:border-l border-hairline bg-paper min-[1100px]:overflow-y-auto">
        <div className="px-5 sm:px-6 py-6 flex flex-col gap-6 max-w-[760px] mx-auto">
          <section className="flex flex-col gap-3">
            <p className="label-mono text-ink-faint">Measured against</p>
            {core ? (
              <CoreAside name={core.name} seed={core.seed} confidence={core.confidence} attributes={core.attributes} trained={core.trained} />
            ) : (
              <p className="text-sm text-ink-muted">No core yet, so this checks the basics only. <Link href={`/w/${tenantId}/brand/voice`} className="hu-link">Set up your voice</Link></p>
            )}
            {lowConfidence}
          </section>

          <section aria-live="polite" className="flex flex-col gap-4 border-t border-hairline pt-6">
            <p className="label-mono text-ink-faint">Verdict</p>
            {result && band ? (
              <div className={`flex flex-col gap-4 ${stale ? "opacity-60" : ""}`}>
                <ScoreMeter score={result.score} band={band} />
                <p className="text-sm text-ink-muted">
                  Measured against {result.corpusPieces} {result.corpusPieces === 1 ? "piece" : "pieces"} of your writing{rule ? `, for ${rule.label}` : ""}.
                  {stale && " You've edited since. Check again for a fresh score."}
                </p>
                {band === "on" ? (
                  <details>
                    <summary className="cursor-pointer min-h-11 flex items-center text-sm text-ink-muted">Details</summary>
                    {findingList}
                  </details>
                ) : (
                  findingList
                )}
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3 text-sm text-ink-muted">
                <span className="w-11 h-11 rounded-md bg-accent-soft text-accent-ink flex items-center justify-center" aria-hidden="true"><ScanText size={18} /></span>
                <p>{checking ? "Scoring it against your voice…" : "Paste a draft and check it. The score, and every line worth changing with a fix in your voice, land here."}</p>
                <p className="text-xs text-ink-faint">It never stops you publishing: it&apos;s your brand.</p>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
