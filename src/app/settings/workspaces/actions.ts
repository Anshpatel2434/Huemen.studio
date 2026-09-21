"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  assignCoach,
  createWorkspace,
  inviteUser,
  setWorkspaceStatus,
} from "@/lib/data/admin";
import type { Role } from "@/lib/auth/types";

export async function createWorkspaceAction(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (name) await createWorkspace(session, name);
  revalidatePath("/settings/workspaces");
}

export async function inviteUserAction(formData: FormData) {
  const session = await requireSession();
  const tenantId = String(formData.get("tenantId"));
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role")) as Role;
  if (email) await inviteUser(session, tenantId, email, role);
  revalidatePath("/settings/workspaces");
}

export async function assignCoachAction(formData: FormData) {
  const session = await requireSession();
  await assignCoach(
    session,
    String(formData.get("tenantId")),
    String(formData.get("coachUserId")),
  );
  revalidatePath("/settings/workspaces");
}

export async function setStatusAction(formData: FormData) {
  const session = await requireSession();
  await setWorkspaceStatus(
    session,
    String(formData.get("tenantId")),
    String(formData.get("status")) as "active" | "archived",
  );
  revalidatePath("/settings/workspaces");
}
