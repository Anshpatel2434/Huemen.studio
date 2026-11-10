import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/types";
import { listAuditLog } from "@/lib/data/admin";

export const metadata = { title: "Audit log" };

const ACTIONS: Record<string, string> = {
  "workspace.create": "Created the workspace",
  "workspace.rename": "Renamed the workspace",
  "workspace.status": "Changed the workspace status",
  "workspace.accent": "Changed the accent colour",
  "user.invite": "Invited",
  "user.reinvite": "Invited again",
  "user.enable": "Turned access on",
  "user.disable": "Turned access off",
  "user.revoke_invite": "Revoked an invite",
  "user.role": "Changed a role",
  "coach.assign": "Assigned a coach",
  "coach.unassign": "Removed a coach",
  "caps.update": "Changed the AI caps",
  "template.update": "Saved a prompt template",
  "template.override_removed": "Removed a prompt override",
};

/** What changed, in a line: the target's email, key, status or values. */
function detail(t: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of ["email", "key", "status", "role", "from", "to", "name", "accent", "version", "scope"]) {
    if (t[k] !== undefined && t[k] !== null) parts.push(k === "email" || k === "key" || k === "name" ? String(t[k]) : `${k} ${String(t[k])}`);
  }
  if (!parts.length && Object.keys(t).length) parts.push(Object.entries(t).map(([k, v]) => `${k} ${v ?? "none"}`).join(", "));
  return parts.join(" · ");
}

/** The latest admin changes (admin_audit_log), newest first. Read-only. */
export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isPlatformAdmin(session.role)) redirect("/settings");
  const rows = await listAuditLog(session);
  return (
    <>
      <h1 className="text-3xl">Audit log</h1>
      <p className="text-ink-muted text-sm mt-2">The last {rows.length} changes made in Workspaces &amp; access and Prompts, newest first.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-faint mt-8">Nothing has been changed yet.</p>
      ) : (
        <ul className="mt-8 rounded-md border border-hairline divide-y divide-[var(--hairline)] bg-paper">
          {rows.map((r, i) => (
            <li key={i} className="px-4 py-3 grid gap-1 md:grid-cols-[11rem_1fr] min-w-0">
              <time dateTime={r.at} className="text-xs text-ink-faint tabular-nums">{new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time>
              <div className="min-w-0">
                <p className="text-sm">
                  {ACTIONS[r.action] ?? r.action}
                  {r.workspace && <span className="text-ink-muted"> · {r.workspace}</span>}
                </p>
                <p className="text-xs text-ink-faint break-words md:truncate">{[detail(r.target), r.actor && `by ${r.actor}`].filter(Boolean).join(" · ")}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
