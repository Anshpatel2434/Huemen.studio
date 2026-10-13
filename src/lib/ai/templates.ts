/**
 * Prompt template store (brief §05, TASKS P2-2). Templates are DATA: resolved by
 * key with a per-tenant override winning over the global row, highest active
 * version first. The resolved id + version are stamped on content for tracing.
 * With no row, the catalogue's built-in default is used and stamped as
 * version 0 with no id, so a draft written before any edit is traceable too.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import { templateDefault } from "./template-defaults";

export interface ResolvedTemplate {
  id: string | null;
  key: string;
  version: number;
  body: string;
}

export async function resolveTemplate(scope: SessionScope, key: string): Promise<ResolvedTemplate> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; version: number; body: string }>(
        `SELECT id, version, body FROM prompt_templates
          WHERE key = $1 AND is_active
          ORDER BY (tenant_id IS NOT NULL) DESC, version DESC LIMIT 1`,
        [key],
      ),
    )
  ).rows[0];
  if (row) return { id: row.id, key, version: row.version, body: row.body };
  return {
    id: null,
    key,
    version: 0,
    body: templateDefault(key) ?? "You write on-brand content in the person's voice, obeying the brand context.",
  };
}
