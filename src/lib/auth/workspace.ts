/**
 * Page/action helpers: resolve the DB scope for a workspace (/w/[id]) or a
 * project inside it (/w/[id]/p/[pid]). Unauthenticated → /login. No access →
 * 404 (don't reveal that it exists). Access rules live in resolveScope (INV-1
 * second line); RLS is first. A project id is only honoured if the project is
 * visible inside the resolved tenant scope.
 *
 * Server-only.
 */
import "server-only";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ForbiddenError, resolveScope } from "@/lib/auth/scope";
import type { SessionScope } from "@/db/session";
import type { Session } from "@/lib/auth/types";
import { getProject, type ProjectRow, type ProjectScope } from "@/lib/data/projects";

export async function workspaceScope(
  tenantId: string,
): Promise<{ session: Session; scope: SessionScope & { tenantId: string } }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) notFound();
  try {
    // Platform admins get a tenant-scoped (NOT admin-bypass) scope for content:
    // client content tables have no admin policy, so reads stay tenant-bound.
    const scope = await resolveScope(session, tenantId);
    return { session, scope: { ...scope, tenantId, isPlatformAdmin: false } };
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
}

export async function projectScope(
  tenantId: string,
  projectId: string,
): Promise<{ session: Session; scope: ProjectScope; project: ProjectRow }> {
  const { session, scope } = await workspaceScope(tenantId);
  const project = await getProject(scope, projectId);
  if (!project) notFound();
  return { session, scope: { ...scope, projectId }, project };
}

/** Same checks for server actions (ids arrive as arguments/form data). */
export async function actionScope(tenantId: string) {
  return (await workspaceScope(tenantId)).scope;
}

export async function actionProjectScope(tenantId: string, projectId: string): Promise<ProjectScope> {
  return (await projectScope(tenantId, projectId)).scope;
}
