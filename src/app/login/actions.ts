"use server";

import { redirect } from "next/navigation";
import { withTenantSession } from "@/db/session";
import { devSignIn } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import type { Role } from "@/lib/auth/types";

/**
 * DEV-ONLY sign-in. Establishes a session for a seeded user. In production the
 * managed auth provider + email invites replace this entirely (brief §02, §05).
 */
export async function signInAs(formData: FormData): Promise<void> {
  if (getEnv().AUTH_DRIVER !== "dev") throw new Error("dev sign-in disabled");
  const userId = String(formData.get("userId"));

  const user = await withTenantSession(
    { tenantId: null, userId: null, isPlatformAdmin: true },
    async (c) =>
      (
        await c.query<{ id: string; tenant_id: string; role: Role; email: string }>(
          "SELECT id, tenant_id, role, email FROM users WHERE id = $1",
          [userId],
        )
      ).rows[0],
  );
  if (!user) throw new Error("user not found");

  await devSignIn({
    userId: user.id,
    tenantId: user.tenant_id,
    role: user.role,
    email: user.email,
  });
  redirect("/dashboard");
}
