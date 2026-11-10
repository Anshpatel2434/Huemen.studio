import Link from "next/link";
import { Package, Pencil, Trash2 } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { listOffers } from "@/lib/data/planning";
import { loadFoundation } from "@/lib/data/foundation";
import { DocPage } from "@/components/doc-page";
import { EmptyState, SubmitButton } from "@/components/ui";
import { createOfferAction, deleteOfferAction, updateOfferAction } from "../actions";

export const metadata = { title: "Offers" };

/** The offer fields, empty for a new one or filled to edit one. */
function OfferFields({ o }: { o?: { name: string; format: string | null; promise: string | null; deliverables: string[]; pricingLogic: string | null } }) {
  return (
    <>
      <input name="name" required defaultValue={o?.name} placeholder="Name, e.g. First 90 Days" className="field" />
      <input name="format" defaultValue={o?.format ?? ""} placeholder="Format, e.g. 6-week cohort" className="field" />
      <textarea name="promise" rows={2} defaultValue={o?.promise ?? ""} placeholder="The promise, in one sentence" className="field" />
      <textarea name="deliverables" rows={4} defaultValue={o?.deliverables.join("\n")} placeholder={"What's included, one per line"} className="field" />
      <textarea name="pricingLogic" rows={2} defaultValue={o?.pricingLogic ?? ""} placeholder="Pricing logic, e.g. anchored to one hire saved" className="field" />
    </>
  );
}

export default async function OffersPage({ params, searchParams }: PageProps<"/w/[id]/plan/offers">) {
  const { id } = await params;
  const sp = await searchParams;
  const editing = typeof sp.edit === "string" ? sp.edit : null;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  const [offers, brief] = await Promise.all([listOffers(scope), loadFoundation(scope)]);
  const fromBrief = brief.offers.trim();

  return (
    <DocPage eyebrow={`${(ws?.name ?? "Your brand")} · Offer designer`} title="Expertise in." accent="Offer out." sub="Package what you know into something people can buy. Every draft knows your offers: what each promises, what is in it and how it is priced.">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="flex flex-col gap-3">
          {offers.length === 0 ? (
            <div><EmptyState
                icon={<Package size={18} />}
                title={fromBrief ? "Your brief names an offer" : "No offers yet"}
                sub={fromBrief ? `“${fromBrief.slice(0, 160)}${fromBrief.length > 160 ? "…" : ""}” Add it here to say what's in it and how it's priced; drafts then know it in full.` : "Start with the one you already sell. Name it, say what it promises, list what's in the box."}
              /></div>
          ) : (
            offers.map((o) => editing === o.id ? (
              <form key={o.id} action={updateOfferAction} className="bg-field rounded-xl p-5 flex flex-col gap-3">
                <input type="hidden" name="tenantId" value={id} />
                <input type="hidden" name="id" value={o.id} />
                <p className="font-medium">Edit offer</p>
                <OfferFields o={o} />
                <div className="flex justify-end gap-2">
                  <Link href={`/w/${id}/plan/offers`} className="inline-flex items-center min-h-11 px-4 text-sm text-ink-muted hover:text-ink">Cancel</Link>
                  <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
                </div>
              </form>
            ) : (
              <article key={o.id} className="bg-field rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="label-mono text-ink-faint">{o.format || "Offer"}</p>
                    <h2 className="text-lg mt-1">{o.name}</h2>
                  </div>
                  <Link href={`/w/${id}/plan/offers?edit=${o.id}`} className="hu-iconbtn" aria-label={`Edit ${o.name}`}><Pencil size={14} aria-hidden="true" /></Link>
                  <form action={deleteOfferAction}>
                    <input type="hidden" name="tenantId" value={id} />
                    <input type="hidden" name="id" value={o.id} />
                    <button className="hu-iconbtn hover:!text-danger" aria-label="Delete offer"><Trash2 size={14} /></button>
                  </form>
                </div>
                {o.promise && <p className="mt-3 text-base serif-accent text-lg leading-snug">“{o.promise}”</p>}
                {o.deliverables.length > 0 && (
                  <ul className="mt-4 grid gap-1.5">
                    {o.deliverables.map((d, i) => <li key={i} className="flex gap-2.5 text-sm"><span className="label-mono text-ink-faint pt-0.5">0{i + 1}</span>{d}</li>)}
                  </ul>
                )}
                {o.pricingLogic && <p className="mt-4 pt-3 border-t border-hairline text-sm text-ink-muted"><span className="font-medium text-ink">Pricing logic:</span> {o.pricingLogic}</p>}
              </article>
            ))
          )}
        </div>

        <form action={createOfferAction} className="bg-field rounded-xl p-5 flex flex-col gap-3 xl:sticky xl:top-0">
          <input type="hidden" name="tenantId" value={id} />
          <p className="font-medium">New offer</p>
          <OfferFields />
          <SubmitButton pendingLabel="Saving…">Save offer</SubmitButton>
        </form>
      </div>
    </DocPage>
  );
}
