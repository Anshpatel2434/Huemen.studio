import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/types";
import { listCoaches, listWorkspaces } from "@/lib/data/admin";
import { signQuestionnaireToken } from "@/lib/invite/token";
import { getEnv } from "@/lib/env";
import {
  assignCoachAction,
  createWorkspaceAction,
  inviteUserAction,
  setStatusAction,
} from "./actions";

export const dynamic = "force-dynamic";

const input = "border border-hairline bg-muted-surface px-2 py-1.5 text-sm focus:outline-none focus:border-ink";
const btn = "bg-ink text-paper px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isPlatformAdmin(session.role)) redirect("/dashboard");

  const [workspaces, coaches] = await Promise.all([
    listWorkspaces(session),
    listCoaches(session),
  ]);

  return (
    <div className="max-w-4xl mx-auto px-10 py-10">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <p className="eyebrow mb-2">Admin</p>
          <h1 className="text-3xl tracking-tight">
            Workspaces <span className="serif-accent">&amp; access.</span>
          </h1>
        </div>
        <Link href="/dashboard" className="text-xs text-ink-muted hover:text-ink">
          ← Back to studio
        </Link>
      </div>

      <form action={createWorkspaceAction} className="flex gap-2 mb-8 border border-hairline p-4">
        <input name="name" placeholder="New workspace name" className={`${input} flex-1`} required />
        <button className={btn} type="submit">Create workspace</button>
      </form>

      <div className="flex flex-col gap-4">
        {workspaces.map((w) => (
          <div key={w.id} className="border border-hairline p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-base">{w.name}</span>
                <span className="eyebrow ml-3">
                  {w.status} · {w.user_count} user{w.user_count === 1 ? "" : "s"}
                </span>
              </div>
              <form action={setStatusAction}>
                <input type="hidden" name="tenantId" value={w.id} />
                <input type="hidden" name="status" value={w.status === "active" ? "archived" : "active"} />
                <button className="text-xs text-ink-muted hover:text-accent" type="submit">
                  {w.status === "active" ? "Archive" : "Restore"}
                </button>
              </form>
            </div>

            <div className="mt-3 flex flex-wrap gap-4">
              <form action={inviteUserAction} className="flex gap-2 items-center">
                <input type="hidden" name="tenantId" value={w.id} />
                <input name="email" type="email" placeholder="invite email" className={input} required />
                <select name="role" className={input} defaultValue="client">
                  <option value="client">client</option>
                  <option value="coach">coach</option>
                  <option value="owner_admin">admin</option>
                </select>
                <button className={btn} type="submit">Invite</button>
              </form>

              {coaches.length > 0 && (
                <form action={assignCoachAction} className="flex gap-2 items-center">
                  <input type="hidden" name="tenantId" value={w.id} />
                  <select name="coachUserId" className={input}>
                    {coaches.map((c) => (
                      <option key={c.id} value={c.id}>{c.email}</option>
                    ))}
                  </select>
                  <button className={btn} type="submit">Assign coach</button>
                </form>
              )}
            </div>

            <p className="mt-3 text-xs text-ink-faint break-all">
              <span className="eyebrow">Questionnaire link ↗</span>{" "}
              {getEnv().APP_URL}/q/{signQuestionnaireToken(w.id)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
