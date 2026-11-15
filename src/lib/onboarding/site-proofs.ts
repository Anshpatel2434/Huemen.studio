/**
 * Turning what a website shows (projects, testimonials) into facts a person
 * can stand behind (identity.proofs, the only facts a draft may use). Built
 * from the saved site read and the positions the person ticked, so nothing
 * typed in the browser becomes a "fact". Client-safe: the screen shows the
 * same wording it will save.
 */
import type { Proof } from "@/lib/voice/types";
import type { SiteDetails, SiteProject, SiteTestimonial } from "@/lib/integrations/site-details";

export interface SitePicks {
  projects: number[];
  testimonials: number[];
}

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");

export function projectProof(p: SiteProject): Proof {
  const what = p.client && !p.title.toLowerCase().includes(p.client.toLowerCase()) ? `${p.title} (for ${p.client})` : p.title;
  const tail = p.result || p.summary;
  return { claim: `Project: ${what}${tail ? `. ${tail.replace(/[.\s]+$/, "")}.` : ""}`.slice(0, 300), source: shortUrl(p.url) };
}

export function testimonialProof(t: SiteTestimonial): Proof {
  const who = [t.author, t.role].filter(Boolean).join(", ");
  return { claim: `A client said: "${t.quote.replace(/[.\s]+$/, "")}."${who ? ` (${who})` : ""}`.slice(0, 300), source: shortUrl(t.from) };
}

/** The ticked items, in order, as proofs. Positions that aren't there are ignored. */
export function proofsFromSite(d: SiteDetails, picks: SitePicks): Proof[] {
  const at = <T,>(list: T[], idx: unknown): T[] =>
    (Array.isArray(idx) ? idx : []).filter((i): i is number => Number.isInteger(i) && i >= 0 && i < list.length).filter((i, n, all) => all.indexOf(i) === n).map((i) => list[i]);
  return [...at(d.projects, picks?.projects).map(projectProof), ...at(d.testimonials, picks?.testimonials).map(testimonialProof)];
}
