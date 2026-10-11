import { workspaceScope } from "@/lib/auth/workspace";
import { loadVisualIdentity } from "@/lib/data/foundation";
import { DocPage } from "@/components/doc-page";
import { VisualForm } from "@/components/visual-form";

export const metadata = { title: "Visual" };

/** Brand core › Visual: the customer's hue, set in onboarding step 3. */
export default async function VisualPage({ params }: PageProps<"/w/[id]/brand/visual">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const visual = await loadVisualIdentity(scope);
  return (
    <DocPage
      eyebrow="Brand core · Visual"
      title="Your"
      accent="hue."
      sub="The colours, fonts and image notes every visual is made from. Set once; every piece reads them."
    >
      <section className="bg-paper border border-hairline rounded-md p-5">
        <VisualForm tenantId={id} initial={visual} />
      </section>
    </DocPage>
  );
}
