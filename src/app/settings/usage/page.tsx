import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listWorkspaceNames } from "@/lib/data/workspaces";
import { loadUsage } from "@/lib/data/insights";
import { Meter } from "@/components/ui";

export const metadata = { title: "AI usage" };

export default async function AiUsagePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const workspaces = (await listWorkspaceNames(session)).filter((w) => w.status !== "archived");
  const rows = await Promise.all(
    workspaces.map(async (w) => ({ ...w, u: await loadUsage({ tenantId: w.id, userId: session.userId, isPlatformAdmin: false }) })),
  );
  const total = rows.reduce((s, r) => s + r.u.textThisMonth + r.u.imagesThisMonth, 0);
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const days = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);

  return (
    <>
      <h1 className="text-[2rem]">AI usage</h1>
      <section className="mt-8 bg-paper border border-hairline rounded-[14px] p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium">Monthly usage</p>
            <p className="text-[0.8rem] text-ink-muted mt-0.5">Resets in {days} day{days === 1 ? "" : "s"}</p>
          </div>
          <span className="h-7 px-2.5 rounded-[7px] bg-field text-[0.78rem] flex items-center">
            {new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
        </div>
        <p className="text-[2rem] mt-4 tabular-nums">{total} <span className="text-[0.9rem] text-ink-muted">generations</span></p>
        <p className="text-[0.8rem] text-ink-muted mt-5 mb-2">Usage by workspace</p>
        <div className="flex flex-col divide-y divide-[var(--hairline)] border-t border-hairline">
          {rows.map((r) => {
            const n = r.u.textThisMonth + r.u.imagesThisMonth;
            return (
              <div key={r.id} className="flex items-center gap-3 h-12">
                <span className="w-6 h-6 rounded-[6px] bg-ink text-on-ink text-[0.65rem] flex items-center justify-center uppercase">{r.name.slice(0, 1)}</span>
                <Link href={`/w/${r.id}/usage`} className="w-40 truncate text-[0.85rem] text-accent-ink hover:underline">{r.name}</Link>
                <div className="flex-1"><Meter value={total ? (n / total) * 100 : 0} /></div>
                <span className="w-12 text-right text-[0.82rem] tabular-nums">{n}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
