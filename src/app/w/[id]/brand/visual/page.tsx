import { Download } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { loadVisualIdentity } from "@/lib/data/foundation";
import { listAssets } from "@/lib/data/assets";
import { DocPage } from "@/components/doc-page";
import { StyleGuide } from "@/components/style-guide";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { listProjects } from "@/lib/data/projects";
import { getWorkspace } from "@/lib/data/workspaces";
import { btnClass } from "@/components/btn";
import { TEMPLATE_KIT } from "@/lib/visual/core";

export const metadata = { title: "Visual" };

/**
 * Brand core › Visual: the Visual Core (Layer 1, M9). Palette with what each
 * colour is for, fonts, logo, layout grid, motifs, photo style and reference
 * designs, read off the website or set by hand. Every visual reads it, and it
 * downloads as a token file for a designer or another tool.
 */
export default async function VisualPage({ params }: PageProps<"/w/[id]/brand/visual">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const [visual, assets, pack, projects, ws] = await Promise.all([
    loadVisualIdentity(scope), listAssets(scope), loadPackForWorkspace(scope), listProjects(scope), getWorkspace(scope),
  ]);
  // The preview is written in their own words: their name and a real first line.
  const brandName = pack && !pack.displayName.includes("@") ? pack.displayName : ws?.name ?? "Your brand";
  const hook = projects.find((p) => p.firstHook)?.firstHook ?? "Say the specific thing, not the safe thing.";
  return (
    <DocPage
      eyebrow="Brand core · Style guide"
      title="Your"
      accent="hue."
      sub="Colours and what each is for, fonts, layout, motifs and the designs that look like you. Set once; every visual reads them."
      action={<a href={`/w/${id}/brand/visual/tokens`} className={btnClass("secondary", "sm")}><Download size={14} aria-hidden="true" /> Download tokens (JSON)</a>}
    >
      <section className="border-t border-hairline pt-6">
        <StyleGuide tenantId={id} initial={visual} references={assets.filter((a) => a.kind === "reference_image").map((a) => ({ id: a.id, url: a.url }))} brandName={brandName} hook={hook} />
      </section>
      <section className="border-t border-hairline pt-6 mt-10">
        <p className="label-mono text-ink-faint mb-3">The template kit</p>
        <ul className="flex flex-wrap gap-2">
          {TEMPLATE_KIT.map((t) => (
            <li key={t.key} className="bg-field rounded-xl px-4 py-3 text-sm"><span className="font-medium">{t.label}</span> <span className="text-ink-faint">{t.width}×{t.height}</span></li>
          ))}
        </ul>
      </section>
    </DocPage>
  );
}
