import Link from "next/link";
import { Check, AlertCircle, FileDown, FileText, Sparkles } from "lucide-react";
import { projectScope } from "@/lib/auth/workspace";
import { loadBrandContext } from "@/lib/context/context-loader";
import { listContent } from "@/lib/data/content";
import { listPillars } from "@/lib/data/planning";
import { listVisuals } from "@/lib/data/pipeline";
import { brandHealth } from "@/lib/data/insights";
import { DocPage } from "@/components/doc-page";
import { btnClass } from "@/components/btn";
import { formatByKey, formatUsesCarousel } from "@/lib/content/formats";

export const metadata = { title: "Export" };

export default async function ExportPage({ params }: PageProps<"/w/[id]/p/[pid]/export">) {
  const { id, pid } = await params;
  const { scope, project } = await projectScope(id, pid);
  const [ctx, content, pillars, visuals] = await Promise.all([loadBrandContext(scope), listContent(scope), listPillars(scope), listVisuals(scope)]);
  const { checks, score } = brandHealth(ctx, content, pillars);
  const open = checks.filter((c) => !c.ok).length;
  const approved = content.filter((c) => c.status === "approved");
  // The pieces with a visual set, and which of its images exist for the format.
  // Images are drawn in the browser (no server route makes them), so the
  // Images section links to the Visual page, where each one downloads.
  const images = content.flatMap((c) => {
    const kinds = new Set(visuals.filter((v) => v.contentItemId === c.id).map((v) => v.kind));
    const names: string[] = [];
    if (kinds.has("single")) names.push("post image");
    if (kinds.has("quote_card")) names.push("quote card");
    if (kinds.has("carousel_frame") && formatUsesCarousel(c.format)) names.push("carousel frames");
    return names.length ? [{ c, names }] : [];
  });
  const firstFlagged = content.find((c) => c.violations.length || !c.cta.trim());
  const fixHref = ctx.degraded ? `/w/${id}/brand/edit` : firstFlagged ? `/w/${id}/p/${pid}/content?item=${firstFlagged.id}` : `/w/${id}/p/${pid}/content`;

  return (
    <DocPage eyebrow={`${project.name} · Export`} title="Ship it" accent="clean." sub="Review brand health, then take the brief and content out as a PDF or as Markdown (Notion-compatible). Direct posting to LinkedIn or Instagram isn't part of v1." width={1000}>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <div className="border-t border-hairline pt-6">
            <p className="font-medium">What goes out</p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[["Brief", `${ctx.completeness}%`], ["Pieces", String(content.length)], ["Approved", String(approved.length)]].map(([k, v]) => (
                <div key={k} className="bg-panel rounded-md px-3 py-3">
                  <p className="text-xs text-ink-muted">{k}</p>
                  <p className="text-xl mt-1 tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            {/* "Approved only" needs something approved: with nothing approved it is
                shown switched off, with the reason, instead of downloading an empty file. */}
            <div className="mt-5 flex flex-wrap gap-2">
              {approved.length > 0 ? (
                <a href={`/w/${id}/p/${pid}/export/markdown?scope=approved`} className={`${btnClass("primary")} max-w-full !whitespace-normal`}><FileDown size={15} /> Markdown · approved only</a>
              ) : (
                <button type="button" disabled aria-describedby="export-approved-why" className={`${btnClass("secondary")} max-w-full !whitespace-normal`}><FileDown size={15} /> Markdown · approved only</button>
              )}
              <a href={`/w/${id}/p/${pid}/export/markdown`} className={`${btnClass(approved.length > 0 ? "secondary" : "primary")} max-w-full !whitespace-normal`}><FileText size={15} /> Markdown · everything</a>
              {approved.length > 0 ? (
                <a href={`/w/${id}/p/${pid}/export/pdf?scope=approved`} className={`${btnClass("secondary")} max-w-full !whitespace-normal`}><FileDown size={15} /> PDF · approved only</a>
              ) : (
                <button type="button" disabled aria-describedby="export-approved-why" className={`${btnClass("secondary")} max-w-full !whitespace-normal`}><FileDown size={15} /> PDF · approved only</button>
              )}
              <a href={`/w/${id}/p/${pid}/export/pdf`} className={`${btnClass("secondary")} max-w-full !whitespace-normal`}><FileText size={15} /> PDF · everything</a>
            </div>
            {approved.length === 0 && (
              <p id="export-approved-why" className="text-xs text-ink-muted mt-2">
                Nothing is approved yet, so there is nothing to export as approved only.{" "}
                <Link href={`/w/${id}/p/${pid}/content`} className="underline underline-offset-2">Approve a piece on Content</Link>, or export everything.
              </p>
            )}
          </div>

          <div className="border-y border-hairline">
            <p className="font-medium px-5 pt-5">Pieces</p>
            {content.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">Nothing drafted yet. <Link href={`/w/${id}/p/${pid}/content`} className="underline">Go to Content</Link>.</p>
            ) : (
              <div className="mt-3 divide-y divide-[var(--hairline)]">
                {content.map((c) => (
                  <Link key={c.id} href={`/w/${id}/p/${pid}/content?item=${c.id}`} className="flex items-center gap-3 px-5 h-12 hover:bg-panel text-sm">
                    <span className={`w-2 h-2 rounded-full ${c.status === "approved" ? "bg-ok" : c.violations.length ? "bg-accent" : "bg-field"}`} />
                    <span className="flex-1 truncate">{c.hook || "Untitled"}</span>
                    <span className="text-xs text-ink-faint">{formatByKey(c.format).label}</span>
                    <span className="text-xs text-ink-faint w-16 text-right capitalize">{c.status}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="border-y border-hairline">
            <p className="font-medium px-5 pt-5">Images</p>
            {images.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">No visuals yet. <Link href={`/w/${id}/p/${pid}/content`} className="underline">Generate them from Content</Link>.</p>
            ) : (
              <>
                <p className="px-5 pt-1 text-xs text-ink-muted">Each image is drawn in your browser at its channel size. Download it from the Visual page: a PNG for the post image and quote card, a zip for the carousel frames.</p>
                <div className="mt-3 divide-y divide-[var(--hairline)]">
                  {images.map(({ c, names }) => (
                    <Link key={c.id} href={`/w/${id}/p/${pid}/visual?item=${c.id}`} className="flex items-center gap-3 px-5 h-12 hover:bg-panel text-sm">
                      <FileDown size={15} className="text-ink-faint shrink-0" aria-hidden="true" />
                      <span className="flex-1 truncate">{c.hook || "Untitled"}</span>
                      <span className="text-xs text-ink-faint text-right truncate max-w-[45%]">{names.join(", ")}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="bg-field rounded-xl p-5 xl:sticky xl:top-0">
          <div className="flex gap-1.5 mb-4">{[0, 1, 2].map((i) => <span key={i} className="h-1 flex-1 rounded-full bg-ink" />)}</div>
          <p className="font-medium">Review brand health</p>
          <p className="text-sm text-ink-muted mt-0.5">Built from the brief&apos;s own rules: completeness, voice guardrails, CTAs, pillars.</p>
          <ul className="mt-4 flex flex-col gap-3">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2.5">
                {c.ok ? <Check size={15} className="mt-0.5 text-ok" /> : <AlertCircle size={15} className="mt-0.5 text-accent-ink" />}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2 text-sm"><span>{c.label}</span><span className="text-ink-muted">{c.value}</span></div>
                  {c.detail && <p className="text-xs text-ink-faint mt-0.5">{c.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
          <Link href={fixHref} className={`${btnClass("secondary")} w-full mt-5`}><Sparkles size={14} /> Fix the first issue</Link>
          <div className="mt-4 flex items-center gap-4 bg-panel rounded-md p-4">
            <span className="relative w-14 h-14 shrink-0">
              <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--field)" strokeWidth="3" />
                <circle cx="18" cy="18" r="15" fill="none" stroke={score >= 80 ? "var(--ok)" : "var(--accent)"} strokeWidth="3" strokeDasharray={`${(score / 100) * 94.2} 94.2`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-base tabular-nums">{score}</span>
            </span>
            <div>
              <p className="text-sm font-medium">{score >= 80 ? "Ready to export" : score >= 40 ? "Safe to export, worth a pass" : "Fix the brief first"}</p>
              {/* Only claim "complete" when every check actually passed: the
                  brief can be well short of finished at a score of 80. */}
              <p className="text-xs text-ink-muted mt-0.5">
                {open === 0
                  ? "Every check passed."
                  : `${open} ${open === 1 ? "check is" : "checks are"} still open, listed above.`}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </DocPage>
  );
}
