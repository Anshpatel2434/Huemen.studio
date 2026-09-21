import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/types";
import { listCoaches, listWorkspaces } from "@/lib/data/admin";
import { signQuestionnaireToken } from "@/lib/invite/token";
import { signLink } from "@/lib/auth/tokens";
import { listMembers } from "@/lib/data/auth";
import { getEnv } from "@/lib/env";
import { Badge, SubmitButton } from "@/components/ui";
import { CopyField } from "./copy-field";
import { assignCoachAction, createWorkspaceAction, inviteUserAction, setStatusAction } from "./actions";

export const metadata = { title: "Workspaces & access" };

/** Owner/Admin console: create, invite, assign, archive — no DB access needed (§4.6). Every action is audited. */
export default async function WorkspacesAdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isPlatformAdmin(session.role)) redirect("/settings");
  const [workspaces, coaches] = await Promise.all([listWorkspaces(session), listCoaches(session)]);
  const appUrl = getEnv().APP_URL;
  const members = await listMembers(workspaces.map((w) => w.id));
  const ROLE = { owner_admin: "Admin", coach: "Coach", client: "Client" } as const;

  return (
    <>
      <h1 className="text-[2rem]">Workspaces &amp; access</h1>
      <p className="text-ink-muted text-[0.9rem] mt-2">Every change here is written to the audit log.</p>

      <form action={createWorkspaceAction} className="mt-8 bg-paper border border-hairline rounded-[14px] p-5 flex gap-2">
        <input name="name" placeholder="New workspace name" className="field flex-1 min-w-0" required />
        <SubmitButton pendingLabel="Creating…">Create</SubmitButton>
      </form>

      <div className="mt-4 flex flex-col gap-4 pb-12">
        {workspaces.map((w) => (
          <section key={w.id} className="bg-paper border border-hairline rounded-[14px] p-5">
            <div className="flex items-center gap-2">
              <Link href={`/w/${w.id}`} className="font-medium hover:underline flex items-center gap-1">{w.name} <ArrowUpRight size={13} className="text-ink-faint" /></Link>
              <Badge tone={w.status === "active" ? "ok" : "warn"}>{w.status}</Badge>
              <span className="text-[0.78rem] text-ink-faint">{w.user_count} user{w.user_count === 1 ? "" : "s"}</span>
              <form action={setStatusAction} className="ml-auto">
                <input type="hidden" name="tenantId" value={w.id} />
                <input type="hidden" name="status" value={w.status === "active" ? "archived" : "active"} />
                <SubmitButton variant={w.status === "active" ? "danger" : "secondary"} size="sm" pendingLabel="…">{w.status === "active" ? "Archive" : "Restore"}</SubmitButton>
              </form>
            </div>

            <div className="mt-4 flex flex-col gap-3 min-w-0">
              <form action={inviteUserAction} className="flex gap-2">
                <input type="hidden" name="tenantId" value={w.id} />
                <input name="email" type="email" placeholder="name@example.com" className="field flex-1 min-w-0" required />
                <select name="role" className="field !w-28 shrink-0" defaultValue="client">
                  <option value="client">Client</option>
                  <option value="coach">Coach</option>
                  <option value="owner_admin">Admin</option>
                </select>
                <SubmitButton variant="secondary" pendingLabel="…">Invite</SubmitButton>
              </form>
              {coaches.length > 0 && (
                <form action={assignCoachAction} className="flex gap-2">
                  <input type="hidden" name="tenantId" value={w.id} />
                  <select name="coachUserId" className="field flex-1 min-w-0">
                    {coaches.map((c) => <option key={c.id} value={c.id}>{c.email}</option>)}
                  </select>
                  <SubmitButton variant="secondary" pendingLabel="…">Assign coach</SubmitButton>
                </form>
              )}
              {members.some((m) => m.tenantId === w.id) && (
                <div>
                  <p className="text-[0.75rem] text-ink-muted mb-1">People</p>
                  <ul className="rounded-[10px] border border-hairline divide-y divide-[var(--hairline)]">
                    {members.filter((m) => m.tenantId === w.id).map((m) => (
                      <li key={m.id} className="px-3 py-2 flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[0.8rem] truncate flex-1 min-w-0">{m.email}</span>
                          <span className="text-[0.72rem] text-ink-faint shrink-0">{ROLE[m.role]}</span>
                          <Badge tone={m.status === "active" ? "ok" : m.status === "invited" ? "accent" : "warn"}>{m.status === "invited" ? "invite pending" : m.status}</Badge>
                        </div>
                        {m.status === "invited" && (
                          <div className="min-w-0">
                            <CopyField value={`${appUrl}/invite/${signLink("invite", m.id, "invited")}`} />
                            <p className="text-[0.68rem] text-ink-faint mt-1">Invite link, valid 7 days. Send it to {m.email}; opening it lets them accept and join.</p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-[0.75rem] text-ink-muted mb-1">Questionnaire link</p>
                <CopyField value={`${appUrl}/q/${signQuestionnaireToken(w.id)}`} />
              </div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
