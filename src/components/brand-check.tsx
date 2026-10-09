"use client";

/**
 * The on-brand check on a piece (design system §15.3 / §15.4): the same two
 * halves as the Check page. The code check scores it instantly; the line
 * findings, each with a fix in the person's voice, follow from a model call.
 *
 * The band decides what leads, never whether you may publish:
 *   on brand  → Export is the primary action, findings fold away
 *   drifting  → findings open, each fix applied in place
 *   off brand → "Rewrite in my voice" becomes primary
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, Wand2, WandSparkles } from "lucide-react";
import { ScoreMeter, Findings, type Finding } from "@/components/composites";
import { AgentDots } from "@/components/ui";
import { btnClass } from "@/components/btn";
import type { JudgeResult } from "@/lib/ai/tasks";
import {
  applyFixAction, checkContentItemAction, judgeContentItemAction, rewriteContentItemAction, type BrandCheckResult,
} from "@/app/w/[id]/p/[pid]/content/actions";

const BAND: Record<string, "on" | "drift" | "off"> = { on_brand: "on", drifting: "drift", off_brand: "off" };
const VERDICT: Record<string, "on" | "drift" | "off"> = { error: "off", warning: "drift", note: "drift" };

export function BrandCheck({ tenantId, projectId, itemId }: { tenantId: string; projectId: string; itemId: string }) {
  const router = useRouter();
  const [res, setRes] = useState<BrandCheckResult | null>(null);
  const [lines, setLines] = useState<JudgeResult["findings"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [judging, startJudge] = useTransition();
  const [working, startWork] = useTransition();

  const run = () => {
    setError(null);
    setLines(null);
    startCheck(async () => {
      try {
        setRes(await checkContentItemAction(tenantId, projectId, itemId));
      } catch {
        setError("The check didn't run. Try again.");
      }
    });
    startJudge(async () => {
      const r = await judgeContentItemAction(tenantId, projectId, itemId);
      if (r.ok) setLines(r.findings.filter((f) => f.verdict !== "on"));
      else setError(r.error);
    });
  };

  const apply = (line: string, fix: string) => startWork(async () => {
    const ok = await applyFixAction(tenantId, projectId, itemId, line, fix);
    if (!ok) return setError("That line has changed since the check. Check again.");
    setLines((l) => l?.filter((x) => x.line !== line) ?? null);
    setRes(await checkContentItemAction(tenantId, projectId, itemId));
    router.refresh();
  });

  const rewrite = () => startWork(async () => {
    const r = await rewriteContentItemAction(tenantId, projectId, itemId);
    if (!r.ok) return setError(r.error);
    router.refresh();
    run();
  });

  const band = res ? BAND[res.band] : null;
  const codeFindings: Finding[] = (res?.issues ?? []).map((i) => ({
    verdict: VERDICT[i.severity] ?? "drift",
    text: i.message,
    why: i.excerpt ? <span className="italic">“{i.excerpt}”</span> : undefined,
  }));

  const list = (
    <div className="flex flex-col gap-2">
      {codeFindings.length > 0 && <Findings items={codeFindings} />}
      {judging && <p className="text-xs text-ink-muted flex items-center gap-2"><AgentDots /> Reading it line by line</p>}
      {(lines ?? []).map((f) => (
        <div key={f.line} className="border border-hairline rounded-md p-3 flex flex-col gap-1.5">
          <p className="text-sm italic">“{f.line}”</p>
          <p className="text-xs text-ink-muted"><span className="font-medium text-ink">{f.attribute}.</span> {f.why}</p>
          {f.fix && (
            <>
              <p className="text-sm"><span className="text-ink-faint">In your voice: </span>{f.fix}</p>
              <button type="button" disabled={working} onClick={() => apply(f.line, f.fix)} className={`${btnClass("secondary", "sm")} self-start`}>Apply</button>
            </>
          )}
        </div>
      ))}
      {!judging && lines && codeFindings.length === 0 && lines.length === 0 && <p className="text-xs text-ink-muted">Nothing to change.</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {!res ? (
        <button onClick={run} disabled={checking} aria-busy={checking} className={`${btnClass("primary", "sm")} w-full`}>
          {checking ? <><AgentDots /> Checking</> : <><WandSparkles size={14} aria-hidden="true" /> Check against brand</>}
        </button>
      ) : (
        <>
          <ScoreMeter score={res.score} band={band ?? undefined} />
          {band === "on" && (
            <Link href={`/w/${tenantId}/p/${projectId}/export`} className={`${btnClass("primary", "sm")} w-full`}>
              Export <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )}
          {band === "off" && (
            <button type="button" disabled={working} onClick={rewrite} className={`${btnClass("primary", "sm")} w-full`}>
              {working ? <><AgentDots /> Rewriting</> : <><Wand2 size={14} aria-hidden="true" /> Rewrite in my voice</>}
            </button>
          )}
          {band === "on" ? (
            <details>
              <summary className="cursor-pointer min-h-11 flex items-center text-xs text-ink-muted">Details</summary>
              {list}
            </details>
          ) : (
            list
          )}
          <button onClick={run} disabled={checking} className={btnClass("ghost", "sm")}>{checking ? "Re-checking" : "Check again"}</button>
        </>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
