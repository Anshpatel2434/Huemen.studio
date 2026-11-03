"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  assignCoach,
  createWorkspace,
  inviteUser,
  parseAccent,
  setUsageCaps,
  setWorkspaceAccent,
  setWorkspaceStatus,
} from "@/lib/data/admin";
import type { Role } from "@/lib/auth/types";
import { signLink } from "@/lib/auth/tokens";
import { getEnv } from "@/lib/env";
import { sendAuthMail } from "@/lib/mail";

export async function createWorkspaceAction(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (name) await createWorkspace(session, name);
  revalidatePath("/settings/workspaces");
}

/**
 * Invite someone and email them the link. If the email can't be sent, the
 * invite still stands and its link stays on this page to copy and send by hand.
 */
export async function inviteUserAction(formData: FormData) {
  const session = await requireSession();
  const tenantId = String(formData.get("tenantId"));
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role")) as Role;
  if (email) {
    const invited = await inviteUser(session, tenantId, email, role);
    if (invited?.status === "invited") {
      await sendAuthMail({
        to: email,
        subject: `You're invited to ${invited.workspace} on Huemen.studio`,
        link: `${getEnv().APP_URL}/invite/${signLink("invite", invited.userId, "invited")}`,
        lines: [`You've been invited to ${invited.workspace} on Huemen.studio.`, "Accept the invite to set up your account. The link works for 7 days."],
        action: "Accept the invite",
      }).catch((e) => console.error(`[invite] email to ${email} not sent: ${e instanceof Error ? e.message : e}`));
    }
  }
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

export async function setCapsAction(formData: FormData) {
  const session = await requireSession();
  const num = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : Number(v);
  };
  await setUsageCaps(session, String(formData.get("tenantId")), {
    textSoft: num("textSoft"),
    textHard: num("textHard"),
    imageSoft: num("imageSoft"),
    imageHard: num("imageHard"),
  });
  revalidatePath("/settings/workspaces");
  revalidatePath("/w", "layout");
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

/**
 * Set a workspace's accent colour (§4.7). Revalidates the workspace shell as
 * well as this page, because the chrome reads the accent on every screen.
 */
export async function setAccentAction(formData: FormData) {
  const session = await requireSession();
  await setWorkspaceAccent(
    session,
    String(formData.get("tenantId")),
    parseAccent(String(formData.get("accent") ?? "")),
  );
  revalidatePath("/settings/workspaces");
  revalidatePath("/w", "layout");
}
