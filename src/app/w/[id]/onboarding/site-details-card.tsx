"use client";

/**
 * Onboarding screen 1, after the read: what the other pages said, read by
 * rules (lib/integrations/site-details): services, projects, testimonials,
 * client logos, contact. Projects and testimonials can be kept as facts the
 * drafts may use (identity.proofs); nothing is ticked to start with, nothing
 * becomes a fact until the person saves it, and the screen shows the wording
 * that will be saved.
 */
import { useState, useTransition, type ReactNode } from "react";
import { Check } from "lucide-react";
import { btnClass } from "@/components/btn";
import { projectProof, testimonialProof } from "@/lib/onboarding/site-proofs";
import type { SiteDetails } from "@/lib/integrations/site-details";
import { siteProofsAction } from "./actions";

const quiet = "min-h-11 px-3 text-sm text-ink-muted underline underline-offset-4 decoration-line hover:text-ink";

const KIND_LABEL: Record<string, string> = { home: "Home", about: "About", services: "Services", work: "Work", testimonials: "Testimonials", contact: "Contact", team: "Team" };

/** "Home, About, Services, 3 service pages, Work, 6 projects, Contact". */
export function pagesLine(pages: SiteDetails["pages"]): string {
  const seen = new Map<string, number>();
  for (const p of pages) seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
  return [...seen]
    .map(([k, n]) => (k === "service" ? `${n} service ${n === 1 ? "page" : "pages"}` : k === "project" ? `${n} ${n === 1 ? "project" : "projects"}` : KIND_LABEL[k] ?? k))
    .join(", ");
}

/** One section of the read: a label, up to four rows, then the rest on request. */
function FoundList<T>({ label, items, row }: { label: string; items: T[]; row: (t: T, i: number) => ReactNode }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 4);
  return (
    <div className="flex flex-col gap-1 border-t border-hairline pt-4">
      <p className="label-mono text-ink-faint mb-1">{label} · {items.length}</p>
      <ul className="flex flex-col">{shown.map((t, i) => <li key={i}>{row(t, i)}</li>)}</ul>
      {items.length > 4 && (
        <button type="button" className={`${quiet} self-start -ml-3`} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${items.length}`}</button>
      )}
    </div>
  );
}

/** A square tick: keep this as a fact you can stand behind. */
function Keep({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on} aria-label={label} title={label} className="shrink-0 w-11 h-11 -my-1.5 -ml-3 grid place-items-center rounded-lg hover:bg-hover">
      <span className={`w-5 h-5 rounded-md border grid place-items-center transition-colors ${on ? "bg-ink border-ink text-paper" : "border-line-strong bg-paper"}`}>
        {on && <Check size={13} aria-hidden="true" />}
      </span>
    </button>
  );
}

export function SiteDetailsCard({ tenantId, details: d }: { tenantId: string; details: SiteDetails }) {
  // Nothing starts ticked: a site read may not be the person's own (2026-11-18
  // test read another firm's site), so a fact is kept only when someone picks it.
  const [projects, setProjects] = useState<Set<number>>(() => new Set());
  const [quotes, setQuotes] = useState<Set<number>>(() => new Set());
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, save] = useTransition();
  const toggle = (set: Set<number>, put: (s: Set<number>) => void, i: number, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(i);
    else next.delete(i);
    put(next);
    setSaved(null);
  };
  const picked = projects.size + quotes.size;
  const tickable = d.projects.length + d.testimonials.length;
  const allOn = tickable > 0 && picked === tickable;
  const tickAll = (on: boolean) => {
    setProjects(new Set(on ? d.projects.map((_, i) => i) : []));
    setQuotes(new Set(on ? d.testimonials.map((_, i) => i) : []));
    setSaved(null);
  };
  const nothing = !d.services.length && !d.projects.length && !d.testimonials.length && !d.clients.length;
  const reach = [...d.contact.emails, ...d.contact.phones, d.contact.address].filter(Boolean);
  const example = d.projects[0] ? projectProof(d.projects[0]) : d.testimonials[0] ? testimonialProof(d.testimonials[0]) : null;

  return (
    <div className="bg-paper border border-hairline rounded-2xl p-5 sm:p-6 flex flex-col gap-4">
      <div>
        <p className="text-lg">What your site shows</p>
        <p className="text-sm text-ink-muted mt-1">Read {d.pages.length} {d.pages.length === 1 ? "page" : "pages"}: {pagesLine(d.pages)}.</p>
        {d.scriptOnly > 0 && <p className="text-sm text-ink-muted mt-1">{d.scriptOnly === 1 ? "One page builds itself" : `${d.scriptOnly} pages build themselves`} in the browser, so there was less to read there.</p>}
        {nothing && <p className="text-sm text-ink-muted mt-1">No services, projects or testimonials were set out clearly enough to read. You can add them on the next screens.</p>}
      </div>

      {d.about && (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-4">
          <p className="label-mono text-ink-faint">About</p>
          <p className="text-sm text-ink-muted line-clamp-4 whitespace-pre-line">{d.about}</p>
        </div>
      )}

      <FoundList label="Services" items={d.services} row={(s) => (
        <div className="py-1.5">
          <p className="text-sm">{s.name}</p>
          {s.about && <p className="text-xs text-ink-muted line-clamp-2 mt-0.5">{s.about}</p>}
        </div>
      )} />

      <FoundList label="Projects" items={d.projects} row={(p, i) => (
        <div className="flex items-start gap-3 py-1.5">
          <Keep on={projects.has(i)} onChange={(on) => toggle(projects, setProjects, i, on)} label={`Keep "${p.title}" as a fact you can stand behind`} />
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt="" loading="lazy" className="w-12 h-12 rounded-lg object-cover border border-hairline shrink-0 bg-field" />
          ) : <span className="w-12 h-12 rounded-lg bg-field shrink-0" aria-hidden="true" />}
          <div className="min-w-0">
            <a href={p.url} target="_blank" rel="noreferrer noopener" className="text-sm hover:underline underline-offset-4 line-clamp-1">{p.title}</a>
            {(p.client || p.result || p.summary) && <p className="text-xs text-ink-muted line-clamp-2 mt-0.5">{[p.client && `For ${p.client}`, p.result || p.summary].filter(Boolean).join(". ")}</p>}
          </div>
        </div>
      )} />

      <FoundList label="What clients say" items={d.testimonials} row={(t, i) => (
        <div className="flex items-start gap-3 py-1.5">
          <Keep on={quotes.has(i)} onChange={(on) => toggle(quotes, setQuotes, i, on)} label="Keep this testimonial as a fact you can stand behind" />
          <div className="min-w-0">
            <p className="text-sm line-clamp-3">&ldquo;{t.quote}&rdquo;</p>
            {(t.author || t.role) && <p className="text-xs text-ink-muted mt-0.5">{[t.author, t.role].filter(Boolean).join(", ")}</p>}
          </div>
        </div>
      )} />

      {d.clients.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-4">
          <p className="label-mono text-ink-faint">Clients and features · {d.clients.length}</p>
          <p className="text-sm text-ink-muted">{d.clients.map((c) => c.name).join(", ")}</p>
        </div>
      )}

      {(reach.length > 0 || d.socials.length > 0) && (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-4">
          <p className="label-mono text-ink-faint">Contact</p>
          {reach.length > 0 && <p className="text-sm text-ink-muted break-words">{reach.join(" · ")}</p>}
          {d.socials.length > 0 && (
            <p className="text-sm text-ink-muted flex flex-wrap gap-x-3 gap-y-1">
              {d.socials.map((s) => <a key={s.network} href={s.url} target="_blank" rel="noreferrer noopener" className="hover:text-ink underline underline-offset-4 decoration-line">{s.network}</a>)}
            </p>
          )}
        </div>
      )}

      {example && (
        <div className="flex flex-col gap-3 border-t border-hairline pt-4">
          <p className="text-sm text-ink-muted">Ticked projects and testimonials become facts your drafts may use, worded like this: <span className="text-ink">{example.claim.length > 140 ? `${example.claim.slice(0, 140)}…` : example.claim}</span></p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!picked || saving}
              className={`${btnClass("secondary", "md")} whitespace-nowrap`}
              onClick={() => save(async () => {
                const r = await siteProofsAction(tenantId, { projects: [...projects], testimonials: [...quotes] });
                setSaved(r.ok ? (r.value.added ? `Saved ${r.value.added} ${r.value.added === 1 ? "fact" : "facts"}.` : "Already saved.") : r.error);
              })}
            >
              {saving ? "Saving" : picked ? `Keep ${picked} as ${picked === 1 ? "a fact" : "facts"}` : "Tick some to keep"}
            </button>
            {tickable > 1 && (
              <button type="button" className={quiet} disabled={saving} onClick={() => tickAll(!allOn)}>{allOn ? "Untick all" : "Tick all"}</button>
            )}
            {saved && <span className="text-sm text-ink-muted flex items-center gap-1.5" role="status"><Check size={14} aria-hidden="true" /> {saved}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
