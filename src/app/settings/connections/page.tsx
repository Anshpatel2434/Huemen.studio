import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Lock, ShieldCheck } from "lucide-react";
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { ownsVoice } from "@/lib/data/training";
import { clientFor, listConnections, unavailableReason } from "@/lib/data/connections";
import { capabilitiesOf, PROVIDERS, type Capability, type ProviderKey } from "@/lib/integrations/providers";
import { Badge, SubmitButton } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { CapabilityRun } from "./capability-run";
import { disconnectAction } from "./actions";

export const metadata = { title: "Connections" };

const REVIEW: Record<Capability["review"], string | null> = {
  none: null,
  verification: "Needs Google verification before launch",
  restricted: "Needs Google's security review before launch",
  partner: "Needs LinkedIn partner approval",
};

function ago(iso: string) {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return d < 1 ? "just now" : d < 60 ? `${d} min ago` : d < 1440 ? `${Math.round(d / 60)} h ago` : `${Math.round(d / 1440)} days ago`;
}

/**
 * Settings › Connections: the accounts a person lets us read, what each one
 * reads, and what it never does. Account settings, because a connection is the
 * person's own: it lives in their workspace and feeds their own voice.
 */
export default async function ConnectionsPage({ searchParams }: PageProps<"/settings/connections">) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login?next=/settings/connections");
  const id = session.tenantId;
  const scope = { ...(await resolveScope(session, id)), tenantId: id };
  const [pack, connections] = await Promise.all([loadPackForWorkspace(scope), listConnections(scope)]);
  const owner = !!pack && ownsVoice({ userId: session.userId, role: session.role }, pack);

  return (
    <>
      <h1 className="text-[2rem]">Connections</h1>
      <p className="text-[0.88rem] text-ink-muted mt-2 max-w-[60ch]">
        Connect the places you already write, and we&apos;ll read what you allow, to learn how you sound. Pick exactly what each one may read. Disconnect any time, and take what it brought in with it.
      </p>
      <div className="flex flex-col gap-4 mt-8">
        {pack && !pack.onboarding.completedAt && (
          <p className="text-[0.85rem] bg-accent-soft rounded-[10px] px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-0">Setting up your voice? Come back to it when you&apos;re done here.</span>
            <Link href={`/w/${id}/onboarding?step=1`} className={btnClass("secondary", "sm")}>Back to setup</Link>
          </p>
        )}
        {typeof sp.connected === "string" && (
          <p role="status" className="text-[0.88rem] bg-ok-soft text-ok rounded-[10px] px-4 py-3 flex items-center gap-2">
            <CheckCircle2 size={15} aria-hidden="true" /> {PROVIDERS[sp.connected as ProviderKey]?.label ?? "Account"} connected.
          </p>
        )}
        {typeof sp.error === "string" && (
          <p role="alert" className="text-[0.88rem] bg-danger-soft text-danger rounded-[10px] px-4 py-3 flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {sp.error}
          </p>
        )}
        {!owner && (
          <p className="text-[0.88rem] bg-field rounded-[10px] px-4 py-3">
            Connections feed your own voice, and there isn&apos;t one for this account yet. Coaches don&apos;t connect accounts on a client&apos;s behalf.
          </p>
        )}

        <p className="text-[0.82rem] text-ink-muted flex items-start gap-2 bg-field rounded-[10px] px-4 py-3">
          <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          We never train shared models on your writing. Email is measured but never quoted in a draft. Access keys are stored encrypted, and disconnecting withdraws them at Google or LinkedIn too.
        </p>

        {(["google", "linkedin"] as ProviderKey[]).map((key) => {
          const p = PROVIDERS[key];
          const c = connections.find((x) => x.provider === key);
          const configured = !!clientFor(key);
          return (
            <section key={key} className="bg-paper border border-hairline rounded-[14px] p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-[1.1rem] flex-1">{p.label}</h2>
                {c ? (
                  <Badge tone={c.status === "connected" ? "ok" : "warn"}>{c.status === "connected" ? "Connected" : "Reconnect"}</Badge>
                ) : (
                  <Badge>{configured ? "Not connected" : "Not set up"}</Badge>
                )}
              </div>
              {c && (
                <p className="text-[0.85rem] text-ink-muted">
                  {c.accountName ?? ""}{c.accountEmail ? ` · ${c.accountEmail}` : ""} · {c.importedPieces} {c.importedPieces === 1 ? "piece" : "pieces"} brought in
                </p>
              )}
              {c?.lastError && <p className="text-[0.82rem] text-warn">{c.lastError}</p>}
              {!configured && (
                <p className="text-[0.82rem] text-ink-faint">Your admin adds the {p.label} app details to switch this on. Until then, upload exports when you add writing.</p>
              )}

              <ul className="flex flex-col divide-y divide-[var(--hairline)] border-t border-hairline">
                {capabilitiesOf(key).map((cap) => {
                  const reason = unavailableReason(cap.key);
                  const granted = c?.granted.includes(cap.key) ?? false;
                  const sync = c?.sync[cap.key];
                  const review = REVIEW[cap.review];
                  return (
                    <li key={cap.key} className="py-4 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.95rem] font-medium flex-1 min-w-0">{cap.label}</span>
                        {review && <span className="label-mono text-ink-faint flex items-center gap-1"><ShieldCheck size={11} aria-hidden="true" /> {review}</span>}
                      </div>
                      <p className="text-[0.85rem] text-ink-muted">{cap.reads}</p>
                      <p className="text-[0.8rem] text-ink-faint">{cap.never}</p>
                      {sync && (
                        <p className="text-[0.78rem] text-ink-faint">
                          Last run {ago(sync.at)}{sync.error ? ` · ${sync.error}` : cap.visibility !== "none" ? ` · ${sync.count} new ${sync.count === 1 ? "piece" : "pieces"}` : ""}
                        </p>
                      )}
                      <div>
                        {reason ? (
                          <p className="text-[0.8rem] text-ink-faint">{reason}</p>
                        ) : !owner ? null : !granted || c?.status !== "connected" ? (
                          cap.key === "profile" && c ? null : (
                            <a href={`/settings/connections/${key}/start${cap.scopes.length ? `?cap=${cap.key}` : ""}`} className={btnClass("secondary", "sm")}>
                              {c?.status === "expired" ? "Reconnect" : cap.key === "profile" ? `Connect ${p.label}` : `Turn on ${cap.label.toLowerCase()}`}
                            </a>
                          )
                        ) : cap.key === "profile" ? (
                          <span className="text-[0.82rem] text-ok flex items-center gap-1.5"><CheckCircle2 size={13} aria-hidden="true" /> Confirmed</span>
                        ) : (
                          <CapabilityRun tenantId={id} cap={cap.key} />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {c && owner && (
                <details className="border-t border-hairline pt-3">
                  <summary className="cursor-pointer min-h-11 flex items-center text-[0.85rem] text-ink-muted">Disconnect {p.label}</summary>
                  <div className="flex flex-col gap-2 pt-2">
                    <p className="text-[0.82rem] text-ink-muted">We&apos;ll withdraw our access at {p.label}. You choose what happens to the {c.importedPieces} {c.importedPieces === 1 ? "piece" : "pieces"} it brought in.</p>
                    <div className="flex flex-wrap gap-2">
                      <form action={disconnectAction}>
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="provider" value={key} />
                        <input type="hidden" name="remove" value="0" />
                        <SubmitButton size="sm" variant="secondary" pendingLabel="Disconnecting…">Disconnect, keep the writing</SubmitButton>
                      </form>
                      <form action={disconnectAction}>
                        <input type="hidden" name="tenantId" value={id} />
                        <input type="hidden" name="provider" value={key} />
                        <input type="hidden" name="remove" value="1" />
                        <SubmitButton size="sm" variant="danger" pendingLabel="Removing…">Disconnect and remove it</SubmitButton>
                      </form>
                    </div>
                  </div>
                </details>
              )}
            </section>
          );
        })}

        <p className="text-[0.82rem] text-ink-muted">
          Rather not connect? Every source also works as an upload or a paste. <Link href={`/w/${id}/onboarding?step=1`} className="text-accent underline underline-offset-2">Add writing</Link>
        </p>
      </div>
    </>
  );
}
