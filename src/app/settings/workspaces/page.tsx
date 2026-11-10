import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isPlatformAdmin, type Role } from "@/lib/auth/types";
import { listAssignments, listCaps, listCoaches, listWorkspaces, rolesFor } from "@/lib/data/admin";
import { loadUsage } from "@/lib/data/insights";
import { signQuestionnaireToken } from "@/lib/invite/token";
import { signLink } from "@/lib/auth/tokens";
import { listMembers } from "@/lib/data/auth";
import { getEnv } from "@/lib/env";
import { Alert, Badge, SubmitButton } from "@/components/ui";
import { ChipChoice } from "@/components/chip-choice";
import { Select } from "@/components/select";
import { CopyField } from "./copy-field";
import { ConfirmSubmit } from "@/components/confirm-submit";
import {
  accentAction,
  assignCoachAction,
  createWorkspaceAction,
  inviteUserAction,
  memberAccessAction,
  memberRoleAction,
  renameWorkspaceAction,
  setCapsAction,
  setStatusAction,
  unassignCoachAction,
} from "./actions";

function CapField({ name, label, value }: { name: string; label: string; value: number | null | undefined }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs text-ink-muted mb-1 truncate">{label}</span>
      <input name={name} type="number" min={0} step={1} inputMode="numeric" defaultValue={value ?? ""} placeholder="none" className="field num" aria-label={label} />
    </label>
  );
}

const ROLE: Record<Role, string> = { owner_admin: "Admin", coach: "Coach", client: "Client" };

export const metadata = { title: "Workspaces & access" };

/** Owner/Admin console: create, invite, assign, turn access off, archive — no DB access needed (§4.6). Every change is audited. */
export default async function WorkspacesAdminPage({ searchParams }: PageProps<"/settings/workspaces">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isPlatformAdmin(session.role)) redirect("/settings");
  const sp = await searchParams;
  const refused = typeof sp.e === "string" ? sp.e : null;
  const note = typeof sp.n === "string" ? sp.n : null;
  const [workspaces, coaches, caps, assignments] = await Promise.all([
    listWorkspaces(session),
    listCoaches(session),
    listCaps(session),
    listAssignments(session),
  ]);
  const appUrl = getEnv().APP_URL;
  const emailsSent = getEnv().MAIL_PROVIDER !== "log";
  const members = await listMembers(workspaces.map((w) => w.id));
  const usage = new Map(
    await Promise.all(
      workspaces.map(async (w) => [w.id, (await loadUsage({ tenantId: w.id, userId: session.userId, isPlatformAdmin: false })).textThisMonth] as const),
    ),
  );

  return (
    <>
      <h1 className="text-3xl">Workspaces &amp; access</h1>
      <p className="text-ink-muted text-sm mt-2">Every change here is written to the audit log.</p>
      {refused && <Alert tone="warning" className="mt-6">{refused}</Alert>}
      {note && <Alert tone="info" className="mt-6">{note}</Alert>}

      <form action={createWorkspaceAction} className="mt-8 bg-paper border border-hairline rounded-md p-5 flex gap-2">
        <input name="name" placeholder="New workspace name" className="field flex-1 min-w-0" required />
        <SubmitButton pendingLabel="Creating…">Create</SubmitButton>
      </form>

      <div className="mt-4 flex flex-col gap-4 pb-12">
        {workspaces.map((w) => {
          const home = w.id === session.tenantId;
          const roles = rolesFor(session, w.id);
          const people = members.filter((m) => m.tenantId === w.id);
          const assigned = assignments.filter((a) => a.tenantId === w.id);
          const assignable = coaches.filter((c) => !assigned.some((a) => a.coachUserId === c.id));
          return (
            <section key={w.id} className="bg-paper border border-hairline rounded-md p-5">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/w/${w.id}`} className="font-medium hover:underline flex items-center gap-1">{w.name} <ArrowUpRight size={13} className="text-ink-faint" /></Link>
                <Badge tone={w.status === "active" ? "ok" : "warn"}>{w.status}</Badge>
                {home && <Badge>your organisation</Badge>}
                <span className="text-xs text-ink-faint">{w.user_count} {w.user_count === 1 ? "person" : "people"}</span>
                {!home && (
                  <form action={setStatusAction} className="ml-auto">
                    <input type="hidden" name="tenantId" value={w.id} />
                    <input type="hidden" name="status" value={w.status === "active" ? "archived" : "active"} />
                    {w.status === "active" ? (
                      <ConfirmSubmit variant="danger" title={`Archive ${w.name}?`} confirmLabel="Archive workspace" body="Nobody can sign in to it or use it while it is archived, including anyone signed in right now. Nothing is deleted; Restore opens it again.">Archive</ConfirmSubmit>
                    ) : (
                      <SubmitButton variant="secondary" size="sm" pendingLabel="…">Restore</SubmitButton>
                    )}
                  </form>
                )}
              </div>
              {w.status === "archived" && <p className="text-xs text-ink-faint mt-2">Archived: nobody can sign in to it or use it, including anyone signed in when it was archived. Restore to open it again.</p>}

              <div className="mt-4 flex flex-col gap-4 min-w-0">
                <form action={inviteUserAction} className="flex flex-col gap-2">
                  <input type="hidden" name="tenantId" value={w.id} />
                  <div className="flex gap-2">
                    <input name="email" type="email" placeholder="name@example.com" className="field flex-1 min-w-0" required aria-label={`Invite to ${w.name}`} />
                    <SubmitButton variant="secondary" pendingLabel="…">Invite</SubmitButton>
                  </div>
                  {roles.length > 1 ? (
                    <ChipChoice name="role" value={roles[0]} options={roles.map((r) => ({ value: r, label: `as ${ROLE[r].toLowerCase()}` }))} />
                  ) : (
                    <input type="hidden" name="role" value={roles[0]} />
                  )}
                  <p className="text-xs text-ink-faint">
                    {home ? "Coaches and admins belong to your organisation. Admins see every workspace; coaches see the ones they are assigned to." : "Invited as a client of this workspace."}
                  </p>
                </form>

                {!home && (
                  <div>
                    <p className="text-xs text-ink-muted mb-1">Coaches</p>
                    {assigned.length > 0 ? (
                      <ul className="flex flex-wrap gap-2 mb-2">
                        {assigned.map((a) => (
                          <li key={a.coachUserId}>
                            <form action={unassignCoachAction} className="flex items-center gap-1 pl-3 pr-1 min-h-9 rounded-full border border-hairline text-sm">
                              <input type="hidden" name="tenantId" value={w.id} />
                              <input type="hidden" name="coachUserId" value={a.coachUserId} />
                              <span className="truncate max-w-[24ch]">{a.email}</span>
                              <SubmitButton variant="ghost" size="sm" pendingLabel="…">Remove</SubmitButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-ink-faint mb-2">No coach assigned.</p>
                    )}
                    {assignable.length > 0 && (
                      <form action={assignCoachAction} className="flex gap-2">
                        <input type="hidden" name="tenantId" value={w.id} />
                        <Select name="coachUserId" label="Coach" className="flex-1" options={assignable.map((c) => ({ value: c.id, label: c.email }))} />
                        <SubmitButton variant="secondary" pendingLabel="…">Assign coach</SubmitButton>
                      </form>
                    )}
                  </div>
                )}

                {people.length > 0 && (
                  <div>
                    <p className="text-xs text-ink-muted mb-1">People</p>
                    <ul className="rounded-md border border-hairline divide-y divide-[var(--hairline)]">
                      {people.map((m) => {
                        const self = m.id === session.userId;
                        // Turned off before they ever joined: that was a withdrawn invite.
                        const revoked = m.status === "disabled" && !m.lastSeen;
                        return (
                          <li key={m.id} className="px-3 py-2 flex flex-col gap-1.5 min-w-0">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <span className="text-sm truncate flex-1 min-w-0">{m.email}{self && <span className="text-ink-faint"> (you)</span>}</span>
                              <span className="text-xs text-ink-faint shrink-0">{ROLE[m.role]}</span>
                              <Badge tone={m.status === "active" ? "ok" : m.status === "invited" ? "accent" : "warn"}>{m.status === "invited" ? "invite pending" : revoked ? "invite revoked" : m.status === "disabled" ? "access off" : m.status}</Badge>
                              {!self && home && m.role !== "client" && (
                                <form action={memberRoleAction}>
                                  <input type="hidden" name="userId" value={m.id} />
                                  <input type="hidden" name="role" value={m.role === "coach" ? "owner_admin" : "coach"} />
                                  <SubmitButton variant="ghost" size="sm" pendingLabel="…">{m.role === "coach" ? "Make admin" : "Make coach"}</SubmitButton>
                                </form>
                              )}
                              {!self && (
                                <form action={memberAccessAction}>
                                  <input type="hidden" name="userId" value={m.id} />
                                  <input type="hidden" name="on" value={m.status === "disabled" ? "true" : "false"} />
                                  {m.status === "disabled" ? (
                                    <SubmitButton variant="secondary" size="sm" pendingLabel="…">{revoked ? "Restore invite" : "Turn access on"}</SubmitButton>
                                  ) : m.status === "invited" ? (
                                    <ConfirmSubmit title={`Withdraw ${m.email}'s invite?`} confirmLabel="Revoke invite" body="The invite link stops working. You can restore the invite later.">Revoke invite</ConfirmSubmit>
                                  ) : (
                                    <ConfirmSubmit title={`Turn off ${m.email}'s access?`} confirmLabel="Turn access off" body="They are signed out on their next click and can't sign in again until you turn access back on. Nothing of theirs is deleted.">Turn access off</ConfirmSubmit>
                                  )}
                                </form>
                              )}
                            </div>
                            {m.status === "invited" && (
                              <div className="min-w-0">
                                <CopyField value={`${appUrl}/invite/${signLink("invite", m.id, "invited")}`} />
                                <p className="text-xs text-ink-faint mt-1">{emailsSent ? `Emailed to ${m.email}. If it hasn't arrived, copy the link and send it yourself; it's valid 7 days.` : `Invite link, valid 7 days. Send it to ${m.email}; opening it lets them accept and join.`}</p>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {!home && (
                  <div>
                    <p className="text-xs text-ink-muted mb-1">Questionnaire link</p>
                    <CopyField value={`${appUrl}/q/${signQuestionnaireToken(w.id)}`} />
                    <p className="text-xs text-ink-faint mt-1">Valid 30 days. Anyone with it can add answers and sample posts to this workspace, so send it only to the client.</p>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2 border-t border-hairline pt-3">
                  <form action={renameWorkspaceAction} className="flex items-end gap-2 min-w-0">
                    <input type="hidden" name="tenantId" value={w.id} />
                    <label className="block flex-1 min-w-0">
                      <span className="block text-xs text-ink-muted mb-1">Name</span>
                      <input name="name" defaultValue={w.name} className="field" required maxLength={80} />
                    </label>
                    <SubmitButton variant="secondary" size="sm" pendingLabel="…">Rename</SubmitButton>
                  </form>
                  <form action={accentAction} className="flex items-end gap-2 min-w-0">
                    <input type="hidden" name="tenantId" value={w.id} />
                    <label className="block flex-1 min-w-0">
                      <span className="block text-xs text-ink-muted mb-1">Accent colour</span>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="size-6 shrink-0 rounded-full border border-hairline" style={{ background: w.accent ?? "var(--accent)" }} />
                        <input name="accent" defaultValue={w.accent ?? ""} placeholder="#FF3429 (house colour)" pattern="#?[0-9a-fA-F]{6}" className="field font-mono" />
                      </span>
                    </label>
                    <SubmitButton variant="secondary" size="sm" pendingLabel="…">Save</SubmitButton>
                  </form>
                </div>

                <form action={setCapsAction} className="border-t border-hairline pt-3">
                  <input type="hidden" name="tenantId" value={w.id} />
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-xs text-ink-muted">Monthly AI caps</p>
                    <p className="text-xs text-ink-faint">{caps.get(w.id)?.textHard != null ? `${usage.get(w.id) ?? 0} of ${caps.get(w.id)!.textHard} text this month` : "No hard cap: unlimited"}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
                    <CapField name="textSoft" label="Text, warn at" value={caps.get(w.id)?.textSoft} />
                    <CapField name="textHard" label="Text, stop at" value={caps.get(w.id)?.textHard} />
                    <CapField name="imageSoft" label="Images, warn at" value={caps.get(w.id)?.imageSoft} />
                    <CapField name="imageHard" label="Images, stop at" value={caps.get(w.id)?.imageHard} />
                    <SubmitButton variant="secondary" size="sm" pendingLabel="…">Save caps</SubmitButton>
                  </div>
                  <p className="text-xs text-ink-faint mt-2">Warn turns the usage meter amber. Stop refuses further generations until the month resets. Empty means no limit; 0 switches it off. Visuals are drawn from templates today, so image caps apply only once an image model is connected.</p>
                </form>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
