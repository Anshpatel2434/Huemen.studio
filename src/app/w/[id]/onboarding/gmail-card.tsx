/**
 * "Add samples": read their sent email in one go. Connecting with Google is the
 * only click; the read starts by itself on the way back, pages through the
 * whole sent folder, and then withdraws access.
 */
import { AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { btnClass } from "@/components/btn";
import { GmailImport } from "@/components/gmail-import";

export type GmailCardState =
  | { kind: "connect" }
  | { kind: "ready"; autoStart: boolean }
  | { kind: "done"; pieces: number };

export function GmailCard({ tenantId, state, error }: { tenantId: string; state: GmailCardState; error?: string }) {
  return (
    <section className="bg-paper border border-hairline rounded-[12px] p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-[1.05rem]">From your sent email</h2>
        <p className="text-[0.88rem] text-ink-muted mt-1">
          The fastest way to teach us how you sound. Sign in with Google and we read the email you sent in the last two years, once.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-[0.85rem] text-danger flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}

      {state.kind === "connect" && (
        <a href="/settings/connections/google/start?cap=gmail&from=onboarding" className={`${btnClass("secondary", "sm")} self-start`}>
          Sign in with Google
        </a>
      )}
      {state.kind === "ready" && <GmailImport tenantId={tenantId} autoStart={state.autoStart} />}
      {state.kind === "done" && (
        <p className="text-[0.85rem] text-ok flex items-center gap-1.5">
          <CheckCircle2 size={14} aria-hidden="true" /> {state.pieces.toLocaleString("en-IN")} of your emails are part of your voice. Remove them any time in Settings › Connections.
        </p>
      )}

      <p className="text-[0.78rem] text-ink-faint flex items-start gap-1.5">
        <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        Only what you sent: never your inbox, other people&apos;s replies, recipients or attachments. Your email is measured to learn your voice and never quoted in a draft. When the read is done we withdraw our access.
      </p>
    </section>
  );
}
