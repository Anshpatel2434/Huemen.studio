import { withTenantSession } from "@/db/session";
import { getEnv } from "@/lib/env";
import { signInAs } from "./actions";

export const dynamic = "force-dynamic";

/**
 * DEV login. Lists seeded users to sign in as, for local development only.
 * Production uses the managed provider's hosted login + email invites.
 */
export default async function LoginPage() {
  const isDev = getEnv().AUTH_DRIVER === "dev";

  const users = isDev
    ? (
        await withTenantSession(
          { tenantId: null, userId: null, isPlatformAdmin: true },
          (c) =>
            c.query<{ id: string; email: string; role: string; tenant: string }>(
              `SELECT u.id, u.email, u.role, t.name AS tenant
                 FROM users u JOIN tenants t ON t.id = u.tenant_id
                WHERE u.status = 'active' ORDER BY u.role`,
            ),
        )
      ).rows
    : [];

  return (
    <main className="flex-1 flex flex-col justify-center max-w-md mx-auto px-8 py-20 w-full">
      <p className="eyebrow mb-4">Sign in</p>
      <h1 className="text-3xl tracking-tight mb-8">
        Welcome <span className="serif-accent">back.</span>
      </h1>

      {!isDev && (
        <p className="text-ink-muted">
          Sign-in is handled by your identity provider. Use the invite link sent
          to your email.
        </p>
      )}

      {isDev && (
        <>
          <p className="text-sm text-ink-faint mb-4">
            Dev mode — choose a seeded account. Run{" "}
            <code className="bg-muted-surface px-1">npm run db:seed</code> if this
            list is empty.
          </p>
          <div className="flex flex-col gap-2">
            {users.map((u) => (
              <form key={u.id} action={signInAs}>
                <input type="hidden" name="userId" value={u.id} />
                <button
                  type="submit"
                  className="w-full text-left border border-hairline hover:border-ink px-4 py-3 transition-colors"
                >
                  <span className="eyebrow">{u.role.replace("_", " ")}</span>
                  <span className="block text-sm mt-1">{u.email}</span>
                  <span className="block text-xs text-ink-faint">{u.tenant}</span>
                </button>
              </form>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
