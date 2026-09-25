import { workspaceScope } from "@/lib/auth/workspace";
import { loadUsage } from "@/lib/data/insights";
import { DocPage } from "@/components/doc-page";
import { Badge, Meter } from "@/components/ui";

export const metadata = { title: "Usage" };

export default async function UsagePage({ params }: PageProps<"/w/[id]/usage">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const u = await loadUsage(scope);
  const max = Math.max(1, ...u.daily.map((d) => d.n));
  const capPct = u.caps.textHard ? Math.round((u.textThisMonth / u.caps.textHard) * 100) : null;

  const stats: [string, string][] = [
    ["Text generations", String(u.textThisMonth)],
    ["Images", String(u.imagesThisMonth)],
    ["Failed calls", String(u.errorsThisMonth)],
    ["Active users", String(u.activeUsers)],
    ["Last activity", u.lastActivity ? new Date(u.lastActivity).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "–"],
  ];

  return (
    <DocPage back={`/w/${id}`} backLabel="Projects" eyebrow="Usage" title="Usage" accent="this month." sub="Every model call is logged before it returns. Provider costs are billed to the account owner, so runaway usage shows up here." width={1000}>
      <div className="bg-paper border border-hairline rounded-[14px] p-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {stats.map(([k, v]) => (
            <div key={k}>
              <p className="text-[0.75rem] text-ink-muted">{k}</p>
              <p className="text-[1.6rem] mt-1 tabular-nums">{v}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 bg-paper border border-hairline rounded-[14px] p-5">
        <div className="flex items-center justify-between">
          <p className="font-medium">Generations · last 14 days</p>
          <span className="text-[0.75rem] text-ink-faint">peak {max}</span>
        </div>
        <div className="mt-5 h-40 flex items-end gap-1.5">
          {u.daily.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
              <span className="text-[0.65rem] text-ink-faint opacity-0 group-hover:opacity-100 tabular-nums">{d.n}</span>
              <div className="w-full rounded-t-[4px] bg-ink/85 group-hover:bg-accent transition-colors" style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n ? 3 : 1, opacity: d.n ? 1 : 0.15 }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[0.7rem] text-ink-faint"><span>{u.daily[0]?.day}</span><span>{u.daily[u.daily.length - 1]?.day}</span></div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 pb-10">
        <div className="bg-paper border border-hairline rounded-[14px] p-5">
          <p className="font-medium">Caps</p>
          {u.caps.textHard || u.caps.textSoft ? (
            <div className="mt-4">
              <div className="flex justify-between text-[0.8rem] mb-1.5"><span>Text</span><span className="tabular-nums">{u.textThisMonth} / {u.caps.textHard ?? "∞"}</span></div>
              <Meter value={capPct ?? 0} tone={capPct !== null && u.caps.textSoft && u.textThisMonth >= u.caps.textSoft ? "accent" : "ink"} />
              <p className="text-[0.75rem] text-ink-faint mt-2">Soft warning at {u.caps.textSoft ?? "–"}, hard stop at {u.caps.textHard ?? "–"}.</p>
            </div>
          ) : (
            <p className="text-[0.85rem] text-ink-muted mt-2">No caps set for this workspace. Admins set a soft warning and a hard stop per workspace.</p>
          )}
        </div>
        <div className="bg-paper border border-hairline rounded-[14px] p-5">
          <p className="font-medium">Recent calls</p>
          {u.recent.length === 0 ? (
            <p className="text-[0.85rem] text-ink-muted mt-2">No generations yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {u.recent.map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-[0.8rem]">
                  <Badge tone={r.status === "ok" ? "ok" : "accent"}>{r.status}</Badge>
                  <span className="capitalize">{r.kind}</span>
                  <span className="text-ink-faint truncate flex-1">{r.model}</span>
                  <span className="text-ink-faint tabular-nums">{r.latencyMs ?? "–"} ms</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DocPage>
  );
}
