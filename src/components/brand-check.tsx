"use client";

/**
 * The on-brand check surfaced on a content item (design system §15.3 / §15.4).
 * Runs the draft against the voice index and shows the coloured score meter and
 * line-level findings. Publishing is never blocked — the band only decides what
 * the UI leads with.
 */
import { useState, useTransition } from "react";
import { WandSparkles } from "lucide-react";
import { ScoreMeter, Findings, type Finding } from "@/components/composites";
import { AgentDots } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { checkContentItemAction, type BrandCheckResult } from "@/app/w/[id]/p/[pid]/content/actions";

const BAND: Record<string, "on" | "drift" | "off"> = { on_brand: "on", drifting: "drift", off_brand: "off" };
const VERDICT: Record<string, "on" | "drift" | "off"> = { error: "off", warning: "drift", note: "on" };

export function BrandCheck({ tenantId, projectId, itemId }: { tenantId: string; projectId: string; itemId: string }) {
  const [res, setRes] = useState<BrandCheckResult | null>(null);
  const [err, setErr] = useState(false);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setErr(false);
      try {
        setRes(await checkContentItemAction(tenantId, projectId, itemId));
      } catch {
        setErr(true);
      }
    });

  const findings: Finding[] = (res?.issues ?? []).map((i) => ({
    verdict: VERDICT[i.severity] ?? "drift",
    text: i.excerpt ?? i.message,
    why: i.excerpt ? i.message : undefined,
  }));

  return (
    <div className="flex flex-col gap-3">
      {!res ? (
        <button onClick={run} disabled={pending} aria-busy={pending} className={`${btnClass("primary", "sm")} w-full`}>
          {pending ? <><AgentDots /> Checking…</> : <><WandSparkles size={14} /> Check against brand</>}
        </button>
      ) : (
        <>
          <ScoreMeter score={res.score} band={BAND[res.band]} />
          {findings.length > 0 && <Findings items={findings} />}
          <button onClick={run} disabled={pending} className={btnClass("ghost", "sm")}>{pending ? "Re-checking…" : "Check again"}</button>
        </>
      )}
      {err && <p className="text-[0.78rem] text-danger">The check didn&apos;t run. Try again.</p>}
    </div>
  );
}
