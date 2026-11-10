"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import {
  AdminError,
  assignCoach,
  createWorkspace,
  inviteUser,
  renameWorkspace,
  setMemberAccess,
  setMemberRole,
  setUsageCaps,
  setWorkspaceAccent,
  setWorkspaceStatus,
  unassignCoach,
} from "@/lib/data/admin";
import type { Role } from "@/lib/auth/types";
import { signLink } from "@/lib/auth/tokens";
import { getEnv } from "@/lib/env";
import { sendAuthMail } from "@/lib/mail";

const PAGE = "/settings/workspaces";

/**
 * Run an admin change. A refusal (AdminError) comes back to the page as a
 * message; anything else is a real failure and is thrown.
 */
async function run(fn: () => Promise<unknown>) {
  let refused: string | null = null;
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    refused = e.message;
  }
  revalidatePath(PAGE);
  if (refused) redirect(`${PAGE}?e=${encodeURIComponent(refused)}`);
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createWorkspaceAction(formData: FormData) {
  const session = await requireSession();
  const name = str(formData, "name");
  if (!name) redirect(`${PAGE}?e=${encodeURIComponent("Give the workspace a name.")}`);
  await run(() => createWorkspace(session, name));
}

/**
 * Invite someone and email them the link. If the email can't be sent, the
 * invite still stands and its link stays on this page to copy and send by hand.
 */
export async function inviteUserAction(formData: FormData) {
  const session = await requireSession();
  const tenantId = str(formData, "tenantId");
  const email = str(formData, "email").toLowerCase();
  const role = str(formData, "role") as Role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`${PAGE}?e=${encodeURIComponent("That doesn't look like an email address.")}`);
  let note: string | null = null;
  await run(async () => {
    const invited = await inviteUser(session, tenantId, email, role);
    if (invited?.existing) {
      note = invited.status === "invited"
        ? `${email} was already invited to ${invited.workspace}; the invite was sent again.`
        : invited.status === "active"
          ? `${email} is already in ${invited.workspace}.`
          : `${email} is in ${invited.workspace} with access off. Turn their access on below instead.`;
    }
    if (invited?.status === "invited") {
      await sendAuthMail({
        to: email,
        subject: `You're invited to ${invited.workspace} on Huemen.studio`,
        link: `${getEnv().APP_URL}/invite/${signLink("invite", invited.userId, "invited")}`,
        lines: [`You've been invited to ${invited.workspace} on Huemen.studio.`, "Accept the invite to set up your account. The link works for 7 days."],
        action: "Accept the invite",
      }).catch((e) => console.error(`[invite] email to ${email} not sent: ${e instanceof Error ? e.message : e}`));
    }
  });
  if (note) redirect(`${PAGE}?n=${encodeURIComponent(note)}`);
}

export async function assignCoachAction(formData: FormData) {
  const session = await requireSession();
  await run(() => assignCoach(session, str(formData, "tenantId"), str(formData, "coachUserId")));
}

export async function unassignCoachAction(formData: FormData) {
  const session = await requireSession();
  await run(() => unassignCoach(session, str(formData, "tenantId"), str(formData, "coachUserId")));
}

export async function memberAccessAction(formData: FormData) {
  const session = await requireSession();
  await run(() => setMemberAccess(session, str(formData, "userId"), str(formData, "on") === "true"));
}

export async function memberRoleAction(formData: FormData) {
  const session = await requireSession();
  await run(() => setMemberRole(session, str(formData, "userId"), str(formData, "role") as Role));
}

export async function renameWorkspaceAction(formData: FormData) {
  const session = await requireSession();
  await run(() => renameWorkspace(session, str(formData, "tenantId"), str(formData, "name")));
  revalidatePath("/w", "layout");
}

export async function accentAction(formData: FormData) {
  const session = await requireSession();
  const accent = str(formData, "accent");
  await run(() => setWorkspaceAccent(session, str(formData, "tenantId"), accent ? (accent.startsWith("#") ? accent : `#${accent}`) : null));
  revalidatePath("/w", "layout");
}

export async function setCapsAction(formData: FormData) {
  const session = await requireSession();
  const num = (k: string) => {
    const v = str(formData, k);
    return v === "" ? null : Number(v);
  };
  await run(() =>
    setUsageCaps(session, str(formData, "tenantId"), {
      textSoft: num("textSoft"),
      textHard: num("textHard"),
      imageSoft: num("imageSoft"),
      imageHard: num("imageHard"),
    }),
  );
  revalidatePath("/w", "layout");
}

export async function setStatusAction(formData: FormData) {
  const session = await requireSession();
  await run(() => setWorkspaceStatus(session, str(formData, "tenantId"), str(formData, "status") as "active" | "archived"));
}
