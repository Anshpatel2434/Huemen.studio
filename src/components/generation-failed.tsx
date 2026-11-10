/**
 * A pillar generation that didn't go through, where it started (P2-3): the
 * plain reason, what was kept, and Try again, which repeats the same request
 * (brand/pillars/actions retryPillarsAction) and returns to this page.
 */
import { Alert, SubmitButton } from "@/components/ui";
import { retryPillarsAction } from "@/app/w/[id]/brand/pillars/actions";

export function GenerationFailed({ tenantId, message, back, ok, keep, focus, count, className = "" }: {
  tenantId: string;
  message: string;
  /** This page's path (no query), to come back to. */
  back: string;
  /** The page's success flag, e.g. "generated=1". */
  ok: string;
  /** Query to keep on a second failure, e.g. "tab=pillars". */
  keep?: string;
  focus?: string;
  count?: string;
  className?: string;
}) {
  return (
    <Alert tone="warning" className={className} title="The pillars weren't generated">
      {message} What you entered is kept.
      {/* Under the text, not beside it: this sits in narrow panels too. */}
      <form action={retryPillarsAction} className="mt-2.5">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="ok" value={ok} />
        {keep && <input type="hidden" name="keep" value={keep} />}
        {focus && <input type="hidden" name="focus" value={focus} />}
        {count && <input type="hidden" name="count" value={count} />}
        <SubmitButton variant="secondary" size="sm" pendingLabel="Trying…">Try again</SubmitButton>
      </form>
    </Alert>
  );
}
