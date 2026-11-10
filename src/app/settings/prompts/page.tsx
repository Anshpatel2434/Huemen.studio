import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/types";
import { listTemplateVersions, listWorkspaces } from "@/lib/data/admin";
import { TEMPLATE_CATALOG, TEMPLATE_GROUP_LABEL, type TemplateGroup } from "@/lib/ai/template-defaults";
import { PromptCard } from "./prompt-card";

export const metadata = { title: "Prompts" };

/**
 * Prompt templates as data (brief §05, TASKS P3-10): every template the
 * studio resolves, what it says today, and an editor that saves a new version
 * without a redeploy. The version used is stamped on each piece, so a change
 * here never rewrites history.
 */
export default async function PromptsAdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isPlatformAdmin(session.role)) redirect("/settings");
  const [versions, workspaces] = await Promise.all([listTemplateVersions(session), listWorkspaces(session)]);
  const groups: TemplateGroup[] = ["format", "brand", "task"];
  const wsName = new Map(workspaces.map((w) => [w.id, w.name]));

  return (
    <>
      <h1 className="text-3xl">Prompts</h1>
      <p className="text-ink-muted text-sm mt-2 leading-relaxed">
        How the studio briefs the model for each kind of writing. Every save is a new version, used from the next draft on; pieces already written keep the version they were made with. The brand context and the output format are added by the code, so an edit here changes how it writes, never what the studio can read back.
      </p>
      {groups.map((g) => (
        <section key={g} className="mt-8">
          <p className="label-mono text-ink-faint mb-3">{TEMPLATE_GROUP_LABEL[g]}</p>
          <div className="flex flex-col gap-3">
            {TEMPLATE_CATALOG.filter((t) => t.group === g).map((t) => (
              <PromptCard
                key={t.key}
                entry={t}
                versions={versions.filter((v) => v.key === t.key).map((v) => ({ ...v, workspaceName: v.tenantId ? wsName.get(v.tenantId) ?? "A workspace" : null }))}
                workspaces={workspaces.filter((w) => w.status === "active").map((w) => ({ id: w.id, name: w.name }))}
              />
            ))}
          </div>
        </section>
      ))}
      <div className="h-12" />
    </>
  );
}
