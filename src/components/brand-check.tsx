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
 *
 * The band follows the findings (lib/voice/judge withLineFindings): a line the
 * reading marks off brand caps the score under "On brand", so the number and
 * the list beside it never disagree.
 *
 * The verdict stays through a fix: applying one removes that line from the
 * list and leaves the rest, and the fix goes on the canvas undo history
 * (Ctrl/Cmd+Z) like any other edit. `copy` is the piece's text as the page
 * has it; when it changes for any other reason (typing, a regenerate, an
 * undo) the verdict is dimmed and says to check again, rather than vanishing.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, Wand2, WandSparkles } from "lucide-react";
import { ScoreMeter, Findings, type Finding } from "@/components/composites";
import { useCanvasHistory } from "@/components/canvas-edit";
import { AgentDots, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import type { LineFinding } from "@/lib/ai/tasks";
import { hasLine, withLineFindings } from "@/lib/voice/judge";
import {
  applyFixAction, checkContentItemAction, judgeContentItemAction, patchContentAction, rewriteContentItemAction, type BrandCheckResult,
} from "@/app/w/[id]/p/[pid]/content/actions";

const BAND: Record<string, "on" | "drift" | "off"> = { on_brand: "on", drifting: "drift", off_brand: "off" };
const VERDICT: Record<string, "on" | "drift" | "off"> = { error: "off", warning: "drift", note: "drift" };

export function BrandCheck({ tenantId, projectId, itemId, copy, limit }: {
  tenantId: string; projectId: string; itemId: string;
  /** The piece's hook, body and call to action as the page has them now. */
  copy: string;
  /** A hard character limit the platform enforces (X: 280), shown as a count on the piece. */
  limit?: { label: string; max: number } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const history = useCanvasHistory();
  const [res, setRes] = useState<BrandCheckResult | null>(null);
  const [lines, setLines] = useState<LineFinding[] | null>(null);
  /** The copy the verdict describes. */
  const [checked, setChecked] = useState<string | null>(null);
  /** The next change of copy is this panel's own (a fix, a rewrite): the verdict moves with it. */
  const [adopt, setAdopt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The line-by-line reading didn't come through (usually the per-minute limit). Said quietly by the button. */
  const [later, setLater] = useState(false);
  const [checking, startCheck] = useTransition();
  const [judging, startJudge] = useTransition();
  const [working, startWork] = useTransition();

  if (adopt && checked !== null && copy !== checked) {
    setAdopt(false);
    setChecked(copy);
  }
  const stale = res !== null && checked !== null && checked !== copy && !adopt;

  const run = () => {
    setError(null);
    setLater(false);
    setLines(null);
    setChecked(copy);
    startCheck(async () => {
      try {
        setRes(await checkContentItemAction(tenantId, projectId, itemId));
      } catch {
        setError("The check didn't run. Try again.");
      }
    });
    startJudge(async () => {
      const r = await judgeContentItemAction(tenantId, projectId, itemId).catch(() => null);
      // The score above needs no model and is already in. A reading that
      // didn't come through is not an error on the piece: the old findings
      // stay hidden and the button says when to try again.
      if (r?.ok) setLines(r.findings.filter((f) => f.verdict !== "on"));
      else setLater(true);
    });
  };

  const apply = (f: LineFinding) => startWork(async () => {
    setError(null);
    const r = await applyFixAction(tenantId, projectId, itemId, { line: f.line, fix: f.fix, remove: f.remove });
    if (!r.ok) return setError("That line has changed since the check. Check again.");
    setAdopt(true);
    // On the canvas undo history, like an edit typed there.
    const put = async (to: string, from: string) => {
      const out = await patchContentAction(tenantId, projectId, itemId, { [r.field]: to }, { learn: false, base: { [r.field]: from } });
      if (out && "conflict" in out) throw new Error(out.conflict);
    };
    history.push({ label: f.remove ? "cut line" : "apply fix", undo: () => put(r.before, r.after), redo: () => put(r.after, r.before) });
    toast(`${f.remove ? "Line cut" : "Fix applied"}. ${typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}Z undoes it.`);
    try {
      setRes(await checkContentItemAction(tenantId, projectId, itemId));
    } catch { /* the old score stays until the next check */ }
    router.refresh();
  });

  const rewrite = () => startWork(async () => {
    setError(null);
    const r = await rewriteContentItemAction(tenantId, projectId, itemId);
    if (!r.ok) return setError(r.error);
    router.refresh();
    run();
    // The copy is about to change to the rewrite: that is what was just checked.
    setAdopt(true);
  });

  // Only findings whose line is still in the copy: an applied fix leaves the
  // list, an undone one comes back, and the rest stay where they were.
  const open = (lines ?? []).filter((f) => hasLine(copy, f.line));
  const shown = res ? withLineFindings(res, open) : null;
  const band = shown ? BAND[shown.band] : null;
  const codeFindings: Finding[] = (res?.issues ?? []).map((i) => ({
    verdict: i.mustFix ? "off" : VERDICT[i.severity] ?? "drift",
    text: i.message,
    why: i.excerpt ? <span className="italic">“{i.excerpt}”</span> : undefined,
  }));

  const list = (
    <div className="flex flex-col gap-2">
      {codeFindings.length > 0 && <Findings items={codeFindings} />}
      {judging && <p className="text-xs text-ink-muted flex items-center gap-2"><AgentDots /> Reading it line by line</p>}
      {open.map((f) => (
        <div key={f.line} className="border border-hairline rounded-md p-3 flex flex-col gap-1.5">
          <p className="text-sm italic">“{f.line}”</p>
          <p className="text-xs text-ink-muted"><span className="font-medium text-ink">{f.attribute}.</span> {f.why}</p>
          {f.remove ? (
            <>
              <p className="text-sm"><span className="text-ink-faint">In your voice: </span>cut this line.</p>
              <button type="button" disabled={working || stale} onClick={() => apply(f)} className={`${btnClass("secondary", "sm")} self-start`}>Cut line</button>
            </>
          ) : f.fix ? (
            <>
              <p className="text-sm"><span className="text-ink-faint">In your voice: </span>{f.fix}</p>
              <button type="button" disabled={working || stale} onClick={() => apply(f)} className={`${btnClass("secondary", "sm")} self-start`}>Apply</button>
            </>
          ) : null}
        </div>
      ))}
      {!judging && !later && lines && codeFindings.length === 0 && open.length === 0 && <p className="text-xs text-ink-muted">Nothing to change.</p>}
    </div>
  );

  // The count is shown whether or not the check has run: a post over the limit
  // is seen at once, not only after a check (QA F9, 2026-11-18).
  const over = limit ? copy.length - limit.max : 0;
  return (
    <div className="flex flex-col gap-3">
      {limit && (
        <p role={over > 0 ? "alert" : undefined} className={`text-xs ${over > 0 ? "text-danger font-medium" : "text-ink-muted"}`}>
          {copy.length} of {limit.max} characters on {limit.label}{over > 0 ? `. ${over} over: cut it, or write it as a thread.` : "."}
        </p>
      )}
      {!res || !shown ? (
        <button onClick={run} disabled={checking} aria-busy={checking} className={`${btnClass("primary", "sm")} w-full`}>
          {checking ? <><AgentDots /> Checking</> : <><WandSparkles size={14} aria-hidden="true" /> Check against brand</>}
        </button>
      ) : (
        <>
          <div className={`flex flex-col gap-3 ${stale ? "opacity-60" : ""}`}>
            <ScoreMeter score={shown.score} band={band ?? undefined} />
            {band === "on" && !stale && (
              <Link href={`/w/${tenantId}/p/${projectId}/export`} className={`${btnClass("primary", "sm")} w-full`}>
                Export <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
            {band === "off" && !stale && (
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
          </div>
          {stale && <p className="text-xs text-ink-muted">The copy has changed since this check. Check again for a fresh score.</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button onClick={run} disabled={checking || judging} className={btnClass(stale ? "secondary" : "ghost", "sm")}>{checking ? "Re-checking" : "Check again"}</button>
            {later && !judging && <p role="status" className="text-xs text-ink-muted">The line-by-line reading is busy. Check again in a minute.</p>}
          </div>
        </>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
