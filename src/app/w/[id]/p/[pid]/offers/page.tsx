import { Package, Trash2 } from "lucide-react";
import { projectScope } from "@/lib/auth/workspace";
import { listOffers } from "@/lib/data/planning";
import { DocPage } from "@/components/doc-page";
import { EmptyState, SubmitButton } from "@/components/ui";
import { createOfferAction, deleteOfferAction } from "../planning-actions";

export const metadata = { title: "Offers" };

export default async function OffersPage({ params }: PageProps<"/w/[id]/p/[pid]/offers">) {
  const { id, pid } = await params;
  const { scope, project } = await projectScope(id, pid);
  const offers = await listOffers(scope);

  return (
    <DocPage eyebrow={`${project.name} · Offer designer`} title="Expertise in." accent="Offer out." sub="Package what you know into something people can buy. Saved offers feed pitch emails as context.">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="flex flex-col gap-3">
          {offers.length === 0 ? (
            <div className="bg-paper border border-hairline rounded-[14px]"><EmptyState icon={<Package size={18} />} title="No offers yet" sub="Start with the one you already sell. Name it, say what it promises, list what's in the box." /></div>
          ) : (
            offers.map((o) => (
              <article key={o.id} className="bg-paper border border-hairline rounded-[14px] p-5">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="label-mono text-ink-faint">{o.format || "Offer"}</p>
                    <h2 className="text-[1.25rem] mt-1">{o.name}</h2>
                  </div>
                  <form action={deleteOfferAction}>
                    <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="projectId" value={pid} />
                    <input type="hidden" name="id" value={o.id} />
                    <button className="w-8 h-8 rounded-[7px] flex items-center justify-center text-ink-faint hover:bg-accent-soft hover:text-accent-ink" aria-label="Delete offer"><Trash2 size={14} /></button>
                  </form>
                </div>
                {o.promise && <p className="mt-3 text-[0.95rem] serif-accent text-[1.15rem] leading-snug">“{o.promise}”</p>}
                {o.deliverables.length > 0 && (
                  <ul className="mt-4 grid gap-1.5">
                    {o.deliverables.map((d, i) => <li key={i} className="flex gap-2.5 text-[0.88rem]"><span className="label-mono text-ink-faint pt-0.5">0{i + 1}</span>{d}</li>)}
                  </ul>
                )}
                {o.pricingLogic && <p className="mt-4 pt-3 border-t border-hairline text-[0.82rem] text-ink-muted"><span className="font-medium text-ink">Pricing logic:</span> {o.pricingLogic}</p>}
              </article>
            ))
          )}
        </div>

        <form action={createOfferAction} className="bg-paper border border-hairline rounded-[14px] p-5 flex flex-col gap-3 xl:sticky xl:top-0">
          <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="projectId" value={pid} />
          <p className="font-medium">New offer</p>
          <input name="name" required placeholder="Name, e.g. First 90 Days" className="field" />
          <input name="format" placeholder="Format, e.g. 6-week cohort" className="field" />
          <textarea name="promise" rows={2} placeholder="The promise, in one sentence" className="field" />
          <textarea name="deliverables" rows={4} placeholder={"What's included, one per line"} className="field" />
          <textarea name="pricingLogic" rows={2} placeholder="Pricing logic, e.g. anchored to one hire saved" className="field" />
          <SubmitButton pendingLabel="Saving…">Save offer</SubmitButton>
        </form>
      </div>
    </DocPage>
  );
}
