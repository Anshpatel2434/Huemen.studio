"use server";

import { revalidatePath } from "next/cache";
import { actionProjectScope } from "@/lib/auth/workspace";
import { createPillar, deletePillar, reorderPillars, updatePillar } from "@/lib/data/planning";

export async function createPillarAction(tenantId: string, projectId: string, name: string, description: string): Promise<string | null> {
  const scope = await actionProjectScope(tenantId, projectId);
  if (!name.trim()) return null;
  const id = await createPillar(scope, name.trim(), description.trim());
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
  return id;
}

export async function reorderPillarsAction(tenantId: string, projectId: string, ids: string[]) {
  const scope = await actionProjectScope(tenantId, projectId);
  await reorderPillars(scope, ids.slice(0, 200));
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
}

export async function updatePillarAction(tenantId: string, projectId: string, id: string, name: string, description: string) {
  const scope = await actionProjectScope(tenantId, projectId);
  if (!name.trim()) return;
  await updatePillar(scope, id, name.trim(), description.trim());
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
}

export async function deletePillarAction(tenantId: string, projectId: string, id: string) {
  const scope = await actionProjectScope(tenantId, projectId);
  await deletePillar(scope, id);
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
}
