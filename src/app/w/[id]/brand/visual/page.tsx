import { Download } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { loadVisualIdentity } from "@/lib/data/foundation";
import { listAssets } from "@/lib/data/assets";
import { DocPage } from "@/components/doc-page";
import { VisualForm } from "@/components/visual-form";
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
  const [visual, assets] = await Promise.all([loadVisualIdentity(scope), listAssets(scope)]);
  const logo = assets.find((a) => a.kind === "logo")?.url ?? visual.core?.site?.logo ?? null;
  return (
    <DocPage
      eyebrow="Brand core · Visual core"
      title="Your"
      accent="hue."
      sub="Colours and what each is for, fonts, layout, motifs and the designs that look like you. Set once; every visual reads them."
      action={<a href={`/w/${id}/brand/visual/tokens`} className={btnClass("secondary", "sm")}><Download size={14} aria-hidden="true" /> Download tokens (JSON)</a>}
    >
      <section className="border-t border-hairline pt-6">
        <VisualForm tenantId={id} initial={visual} logoUrl={logo} references={assets.filter((a) => a.kind === "reference_image")} back={`/w/${id}/brand/visual`} />
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
