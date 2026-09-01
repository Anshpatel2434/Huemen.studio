import { requireSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { loadBrandContext } from "@/lib/context/context-loader";

/**
 * Overview. Demonstrates the full spine end to end: verified session →
 * access-checked scope → RLS-scoped query → ONE versioned context builder →
 * the completeness indicator (brief §4.1, P1-10).
 */
export default async function DashboardOverview() {
  const session = await requireSession();
  const scope = await resolveScope(session);
  const ctx = await loadBrandContext(scope);

  return (
    <div>
      <p className="eyebrow mb-2">Overview</p>
      <h1 className="text-3xl tracking-tight mb-8">
        Brand foundation <span className="serif-accent">health.</span>
      </h1>

      <section className="border border-hairline p-6">
        <div className="flex items-baseline justify-between mb-3">
          <span className="eyebrow">Completeness</span>
          <span className="text-2xl tabular-nums">{ctx.completeness}%</span>
        </div>
        <div className="h-1.5 bg-muted-surface w-full">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${ctx.completeness}%` }}
          />
        </div>

        {ctx.degraded ? (
          <p className="mt-4 text-sm text-ink-muted">
            The foundation is thin, so generated output would read generic. Fill
            the gaps below before generating — the studio degrades on purpose
            rather than producing off-brand copy silently.
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            Foundation looks solid. Content and images will be generated from
            this context automatically — no brand details to type into a prompt.
          </p>
        )}

        {ctx.warnings.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1">
            {ctx.warnings.map((w) => (
              <li key={w} className="text-sm text-ink-faint flex gap-2">
                <span className="text-accent" aria-hidden>
                  •
                </span>
                {w}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-ink-faint">
        Context version {ctx.version} · language {ctx.language} · guardrails:{" "}
        {ctx.guardrails.dontWords.length} avoid-words active
      </p>
    </div>
  );
}
