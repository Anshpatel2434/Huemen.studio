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
import { useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { Check as CheckIcon, Copy, ScanText, Undo2, Wand2 } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots, Alert } from "@/components/ui";
import { CoreAside, ScoreMeter, Findings, type Finding } from "@/components/composites";
import { PLATFORM_RULES } from "@/lib/voice/platforms";
import type { CheckOutcome } from "@/lib/data/check";
import type { LineFinding } from "@/lib/ai/tasks";
import type { IssueSeverity } from "@/lib/voice/check";
import { applyFinding, hasLine, withLineFindings } from "@/lib/voice/judge";
import { checkAction, judgeAction, rewriteAction } from "./actions";
import { refusedClaims } from "./refused";
import { Select } from "@/components/select";

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
  const [findings, setFindings] = useState<LineFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The line-by-line reading didn't come through (usually the per-minute limit): said by the Check button, not as an error. */
  const [later, setLater] = useState(false);
  /** The draft as it was before each applied fix, newest last: "Undo fix" steps back through them. */
  const [undo, setUndo] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  /** Claims the last rewrite left out because the brand facts don't back them (./refused). */
  const [refused, setRefused] = useState<string[]>([]);
  const [checking, startCheck] = useTransition();
  const [judging, startJudge] = useTransition();
  const [rewriting, startRewrite] = useTransition();
  const [checkedText, setCheckedText] = useState("");

  // In flight, as a ref: the transition flags turn true one render late, so a
  // burst of clicks on "Check it" each started a paid model call (2026-11-17).
  const checkBusy = useRef(false);
  const run = (draft: string) => {
    if (checkBusy.current) return;
    checkBusy.current = true;
    setError(null);
    setLater(false);
    setFindings(null);
    setCheckedText(draft);
    startCheck(async () => {
      const r = await checkAction(tenantId, draft, platform);
      if (!r.ok) return setError(r.error);
      setResult(r.value);
    });
    // The line findings are a model call: started alongside, shown when ready.
    startJudge(async () => {
      try {
        const r = await judgeAction(tenantId, draft, platform).catch(() => null);
        // The score above is computed without the model and is already in. A
        // reading that didn't come through (right after a rewrite it is often
        // the per-minute limit) is not an error on the draft: the old findings
        // stay hidden and the Check button says when to try again.
        if (!r?.ok) return setLater(true);
        setFindings(r.value);
      } finally {
        checkBusy.current = false;
      }
    });
  };

  // A fix changes the draft where the line stands (or cuts the line). The
  // other findings stay, and the draft as it was goes on the undo stack.
  const applyFix = (f: LineFinding) => {
    const next = applyFinding(text, f);
    if (next === null) return setError("That line has changed since the check. Check again.");
    setError(null);
    setUndo((u) => [...u.slice(-19), text]);
    setText(next);
  };
  const undoFix = () => {
    const prev = undo[undo.length - 1];
    if (prev === undefined) return;
    setUndo((u) => u.slice(0, -1));
    setText(prev);
    setRefused([]);
  };

  // A ref, not the transition flag: `rewriting` turns true one render later, so
  // fast repeat clicks could each start a paid model call (2026-11-17 test).
  const rewriteBusy = useRef(false);
  const rewrite = () => {
    if (rewriteBusy.current) return;
    rewriteBusy.current = true;
    startRewrite(async () => {
      try {
        setError(null);
        const r = await rewriteAction(tenantId, text, platform);
        if (!r.ok) return setError(r.error);
        // Say which claims it left out, from what the check already flagged.
        setRefused(refusedClaims(result?.issues ?? [], text, r.value));
        // The rewrite can be undone like a fix.
        setUndo((u) => [...u.slice(-19), text]);
        setText(r.value);
        run(r.value);
      } finally {
        rewriteBusy.current = false;
      }
    });
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the textarea is selectable */ }
  };

  // Only findings whose line is still in the draft: an applied fix leaves the
  // list, an undone one comes back, the rest stay where they were.
  const lineFindings = (findings ?? []).filter((f) => f.verdict !== "on" && hasLine(text, f.line));
  // The band follows the findings: a line read as off brand caps the score
  // under "On brand" (lib/voice/judge), so the two never disagree.
  const verdict = result ? withLineFindings(result, lineFindings) : null;
  const band = verdict ? BAND[verdict.band] : null;
  const stale = result && checkedText !== text;
  const rule = PLATFORM_RULES[platform];
  const codeFindings: Finding[] = (result?.issues ?? []).map((i) => ({
    verdict: i.mustFix ? "off" : SEVERITY[i.severity],
    text: i.message,
    why: i.excerpt ? <span className="italic">“{i.excerpt}”</span> : undefined,
  }));

  const findingList = (
    <div className="flex flex-col gap-3">
      {codeFindings.length > 0 && <Findings items={codeFindings} />}
      {judging && <p className="text-sm text-ink-muted flex items-center gap-2"><AgentDots /> Reading it line by line</p>}
      {lineFindings.map((f) => (
        <div key={f.line} className="border-l-2 border-line-strong pl-3.5 py-1 flex flex-col gap-2">
          <p className="text-sm italic">“{f.line}”</p>
          <p className="text-sm text-ink-muted"><span className="font-medium text-ink">{f.attribute}.</span> {f.why}</p>
          {(f.remove || f.fix) && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm flex-1 min-w-0"><span className="text-ink-faint">In your voice: </span>{f.remove ? "cut this line." : f.fix}</p>
              <button type="button" onClick={() => applyFix(f)} className={btnClass("secondary", "sm")}>{f.remove ? "Cut line" : "Apply"}</button>
            </div>
          )}
        </div>
      ))}
      {!judging && !later && findings && codeFindings.length === 0 && lineFindings.length === 0 && (
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
        <div className="page py-8 flex flex-col gap-5">
          {intro}
          {/* One open composer, no card-in-card: the words, then one bar of controls. */}
          <div className="hu-composer max-w-[960px]">
            <label htmlFor="check-text" className="sr-only">Your draft</label>
            <textarea
              id="check-text"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim() && !checking) { e.preventDefault(); setRefused([]); run(text); } }}
              className="!text-lg !leading-relaxed min-h-[280px] !resize-y placeholder:text-ink-faint"
              placeholder="Paste a draft: one from here, one you wrote yourself, or one someone wrote for you."
            />
            <div className="hu-composer__bar">
              <Select
                label="Platform"
                value={platform}
                onChange={setPlatform}
                variant="pill"
                className="shrink-0"
                options={Object.values(PLATFORM_RULES).map((p) => ({ value: p.key, label: `${p.label}${platforms.includes(p.key) ? "" : " (not set up)"}` }))}
              />
              <p className="flex-1 basis-[28ch] flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint tabular-nums font-mono">
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
                <button type="button" disabled={!text.trim() || checking} onClick={() => { setRefused([]); run(text); }} className={btnClass(band === "off" || (band === "on" && !stale) ? "secondary" : "primary")}>
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
                {undo.length > 0 && (
                  <button type="button" onClick={undoFix} className={btnClass("ghost")}>
                    <Undo2 size={15} aria-hidden="true" /> Undo fix
                  </button>
                )}
              </div>
            </div>
          </div>
          {later && !judging && (
            <p role="status" className="text-sm text-ink-muted max-w-[960px]">The score is in. The line-by-line reading is busy: check again in a minute.</p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {refused.length > 0 && (
            <div role="status" className="max-w-[960px] border-l-2 border-line-strong pl-3.5 py-1 flex flex-col gap-1.5">
              <p className="text-sm font-medium">Left out: not in your brand facts</p>
              <ul className="flex flex-col gap-1 text-sm text-ink-muted">
                {refused.slice(0, 5).map((c) => <li key={c} className="italic">“{c}”</li>)}
                {refused.length > 5 && <li>and {refused.length - 5} more</li>}
              </ul>
              <p className="text-xs text-ink-faint">Add the real fact to your brand to keep a claim like this.</p>
            </div>
          )}
        </div>
      </div>

      {/* Whose voice, and the verdict */}
      <aside aria-label="Your core and the verdict" className="border-t min-[1100px]:border-t-0 min-[1100px]:border-l border-hairline bg-paper min-[1100px]:overflow-y-auto">
        <div className="px-5 sm:px-6 py-6 flex flex-col gap-6">
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
            {result && verdict && band ? (
              <div className="flex flex-col gap-4">
                {/* The score dims once the draft has moved on; the findings stay readable so the rest can still be applied. */}
                <div className={stale ? "opacity-60" : ""}><ScoreMeter score={verdict.score} band={band} /></div>
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
