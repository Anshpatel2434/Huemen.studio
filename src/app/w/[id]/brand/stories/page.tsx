import { BookOpen } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { DocPage } from "@/components/doc-page";
import { EmptyState } from "@/components/ui";
import { ProofsEditor, StoriesEditor } from "../../onboarding/enrich-ui";

export const metadata = { title: "Stories and facts" };
export const dynamic = "force-dynamic";

/**
 * Brand core › Stories and facts: the stories they tell and the facts they can
 * stand behind. The same editors and server actions as Getting started's
 * "Stories and facts" tab (onboarding/enrich-ui, onboarding/actions
 * storiesAction and proofsAction), so both places edit one record in the
 * voice pack, scoped to this workspace the same way.
 */
export default async function StoriesPage({ params }: PageProps<"/w/[id]/brand/stories">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);

  if (!pack) {
    return (
      <DocPage eyebrow="Brand core · Stories and facts" title="No voice yet." sub="Stories and facts belong to the person whose brand this is. They open once their voice pack exists.">
        <div className="border-y border-hairline">
          <EmptyState icon={<BookOpen size={18} />} title="No pack on file" sub="Voice packs are created for the person whose writing they describe." />
        </div>
      </DocPage>
    );
  }

  return (
    <DocPage
      eyebrow="Brand core · Stories and facts"
      title="What only"
      accent="you can say."
      sub="The stories you come back to and the facts you can prove. Drafts use these and never invent their own."
    >
      <div className="flex flex-col gap-6 max-w-3xl">
        <StoriesEditor tenantId={id} initial={pack.identity.stories?.value ?? []} />
        <ProofsEditor tenantId={id} initial={pack.identity.proofs?.value ?? []} />
      </div>
    </DocPage>
  );
}
