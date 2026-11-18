import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { proposeTopics } from "@/lib/data/create";
import { userMessage } from "@/lib/ai/errors";
import { AgentDots, Alert } from "@/components/ui";
import { startPieceAction } from "./actions";

/**
 * Suggestion cards: never narrower than 212px (three fit Brand home's main
 * column at about 220px each), wrapping to fewer columns when there is no room.
 */
const CARD_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(212px,100%),1fr))] gap-3";

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
    // No pillars yet, or every suggestion is a piece already started (those are never offered twice).
    return <p className="text-sm text-ink-muted">Nothing new to suggest right now. Topics come from your pillars, and ones you&apos;ve already started aren&apos;t offered again. <Link href={`/w/${tenantId}/brand/pillars`} className="text-accent underline underline-offset-2">Pillars</Link></p>;
  }
  return (
    // As many columns as fit at 220px or more each, so a card is never squeezed
    // into a strip of one word per line: three across, then two, then one.
    <div className={CARD_GRID}>
      {topics.slice(0, limit).map((t) => (
        <Start key={t.title} tenantId={tenantId} topic={t.title} pillar={t.pillar} format={format} className="flex min-w-0">
          <button type="submit" className="hu-lift flex-1 min-w-0 text-left bg-field border border-transparent rounded-xl p-5 flex flex-col gap-2 min-h-11">
            {/* One line with an ellipsis; the whole name is still the button's text for a screen reader. */}
            {t.pillar && <span className="label-mono text-ink-faint block max-w-full truncate">{t.pillar}</span>}
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
    <div aria-hidden="true" className={CARD_GRID}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="bg-field rounded-xl p-5 flex flex-col gap-3 min-h-[150px]">
          <span className="hu-skel block h-3 w-20" />
          <span className="hu-skel block h-4 w-full" />
          <span className="hu-skel block h-4 w-4/5" />
          <span className="hu-skel block h-3 w-3/5 mt-auto" />
        </span>
      ))}
    </div>
  </div>
);
