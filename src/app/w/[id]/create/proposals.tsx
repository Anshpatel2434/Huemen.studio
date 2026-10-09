import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { proposeTopics } from "@/lib/data/create";
import { userMessage } from "@/lib/ai/errors";
import { AgentDots, Alert } from "@/components/ui";
import { startPieceAction } from "./actions";

/** A one-click start: posts the topic (and its pillar, idea, format) to Create. */
export const Start = ({ tenantId, topic, pillar, ideaId, format, children, className }: {
  tenantId: string; topic: string; pillar?: string | null; ideaId?: string; format?: string | null; children: React.ReactNode; className?: string;
}) => (
  <form action={startPieceAction} className={className}>
    <input type="hidden" name="tenantId" value={tenantId} />
    <input type="hidden" name="topic" value={topic} />
    {pillar && <input type="hidden" name="pillar" value={pillar} />}
    {ideaId && <input type="hidden" name="ideaId" value={ideaId} />}
    {format && <input type="hidden" name="format" value={format} />}
    {children}
  </form>
);

/**
 * Proposals render on their own so the page never waits on them. They are
 * cached on the pack for a week, so most visits cost nothing.
 */
export async function Proposals({ tenantId, format, limit }: { tenantId: string; format: string | null; limit?: number }) {
  const { scope } = await workspaceScope(tenantId);
  let topics;
  try {
    topics = await proposeTopics(scope);
  } catch (e) {
    return <Alert tone="danger">{userMessage(e)}</Alert>;
  }
  if (!topics.length) {
    return <p className="text-sm text-ink-muted">Set your pillars and we&apos;ll suggest topics from them. <Link href={`/w/${tenantId}/brand/pillars`} className="text-accent underline underline-offset-2">Pillars</Link></p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {topics.slice(0, limit).map((t) => (
        <Start key={t.title} tenantId={tenantId} topic={t.title} pillar={t.pillar} format={format} className="flex">
          <button type="submit" className="hu-lift flex-1 text-left bg-paper border border-hairline rounded-md p-4 flex flex-col gap-2 min-h-11">
            {t.pillar && <span className="label-mono text-ink-faint line-clamp-1" title={t.pillar}>{t.pillar}</span>}
            <span className="text-base font-medium leading-snug">{t.title}</span>
            <span className="text-sm text-ink-muted flex-1">{t.why}</span>
            <span className="text-sm font-medium flex items-center gap-1.5">Start this <ArrowRight size={14} aria-hidden="true" /></span>
          </button>
        </Start>
      ))}
    </div>
  );
}

/** Holds the cards' place while the topics are found, so nothing jumps when they land. */
export const ProposalsLoading = ({ count = 3 }: { count?: number }) => (
  <div role="status" className="flex flex-col gap-3">
    <p className="text-sm text-ink-muted flex items-center gap-2"><AgentDots /> Finding topics in your pillars</p>
    <div aria-hidden="true" className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="bg-paper border border-hairline rounded-md p-4 flex flex-col gap-3 min-h-[150px]">
          <span className="hu-skel block h-3 w-20" />
          <span className="hu-skel block h-4 w-full" />
          <span className="hu-skel block h-4 w-4/5" />
          <span className="hu-skel block h-3 w-3/5 mt-auto" />
        </span>
      ))}
    </div>
  </div>
);
