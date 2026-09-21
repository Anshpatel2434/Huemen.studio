"use client";

/**
 * Home sidebar, modelled on Figma's file browser: account/workspace switcher,
 * search, Recents; the workspace section (projects, archived, usage); a plan
 * and usage card; Starred projects; one bottom action.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  ChevronDown, Check, Clock, LayoutGrid, BarChart3, Settings, Users, LogOut, Plus, Search, Archive, Star, ChevronRight,
} from "lucide-react";
import { signOutAction } from "@/app/dashboard/actions";
import { ThemeSwitch } from "@/components/theme";

const ROLE: Record<string, string> = { owner_admin: "Admin", coach: "Coach", client: "Client" };

function Row({ href, icon: Icon, label, on }: { href: string; icon: typeof Clock; label: string; on: boolean }) {
  return (
    <Link href={href} className={`flex items-center gap-2.5 h-8 px-2.5 rounded-[7px] text-[0.8rem] ${on ? "bg-accent-soft text-ink font-medium" : "text-ink-muted hover:bg-field hover:text-ink"}`}>
      <Icon size={15} /> <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}

export function HomeSidebar({ workspace, workspaces, user, isAdmin, starred, usage }: {
  workspace: { id: string; name: string };
  workspaces: { id: string; name: string }[];
  user: { email: string; role: string };
  isAdmin: boolean;
  starred: { id: string; name: string }[];
  usage: { used: number; cap: number | null };
}) {
  const path = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") ?? "recents";
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(params.get("q") ?? "");
  const home = `/w/${workspace.id}`;
  const isHome = path === home;

  return (
    <aside className="w-[240px] shrink-0 border-r border-hairline bg-paper flex flex-col">
      {/* Account / workspace switcher */}
      <div className="p-2 relative">
        <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 h-10 px-2 rounded-[8px] hover:bg-field">
          <span className="w-6 h-6 rounded-full bg-ink text-on-ink text-[0.62rem] font-medium flex items-center justify-center uppercase shrink-0">{user.email.slice(0, 1)}</span>
          <span className="flex-1 min-w-0 text-left text-[0.82rem] font-medium truncate">{user.email.split("@")[0]}</span>
          <ChevronDown size={13} className="text-ink-faint" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="absolute left-2 right-2 top-12 z-40 bg-paper border border-hairline rounded-[12px] shadow-[var(--shadow-lg)] p-1.5 pop">
              <p className="px-2 pt-1 text-[0.78rem] font-medium truncate">{user.email}</p>
              <p className="px-2 pb-2 text-[0.7rem] text-ink-faint">{ROLE[user.role] ?? user.role}</p>
              <p className="label-mono text-ink-faint px-2 pt-1.5 pb-1 border-t border-hairline">Workspaces</p>
              <div className="max-h-64 overflow-y-auto">
                {workspaces.map((w) => (
                  <Link key={w.id} href={`/w/${w.id}`} onClick={() => setOpen(false)} className="flex items-center gap-2 h-8 px-2 rounded-[7px] hover:bg-field text-[0.8rem]">
                    <span className="w-5 h-5 rounded-[5px] bg-ink text-on-ink text-[0.58rem] flex items-center justify-center uppercase">{w.name.slice(0, 1)}</span>
                    <span className="flex-1 truncate">{w.name}</span>
                    {w.id === workspace.id && <Check size={13} />}
                  </Link>
                ))}
              </div>
              <div className="border-t border-hairline mt-1 pt-1">
                {isAdmin && <Link href="/settings/workspaces" className="flex items-center gap-2 h-8 px-2 rounded-[7px] hover:bg-field text-[0.8rem] text-ink-muted"><Plus size={13} /> New workspace</Link>}
                <Link href="/settings" className="flex items-center gap-2 h-8 px-2 rounded-[7px] hover:bg-field text-[0.8rem] text-ink-muted"><Settings size={13} /> Settings</Link>
                <form action={signOutAction}><button className="w-full flex items-center gap-2 h-8 px-2 rounded-[7px] hover:bg-field text-[0.8rem] text-ink-muted"><LogOut size={13} /> Sign out</button></form>
              </div>
            </div>
          </>
        )}
      </div>

      <form
        className="px-2"
        onSubmit={(e) => { e.preventDefault(); router.push(`${home}?view=all${q ? `&q=${encodeURIComponent(q)}` : ""}`); }}
      >
        <label className="flex items-center gap-2 h-8 px-2.5 rounded-[7px] bg-field text-ink-faint">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="bg-transparent outline-none text-[0.8rem] text-ink flex-1 min-w-0 placeholder:text-ink-faint" />
        </label>
      </form>

      <nav className="px-2 mt-2 flex flex-col gap-0.5">
        <Row href={home} icon={Clock} label="Recents" on={isHome && view === "recents"} />
      </nav>

      <div className="mx-3 my-3 h-px bg-hairline" />

      {/* Workspace section */}
      <div className="px-2">
        <div className="flex items-center gap-2 h-8 px-2.5">
          <span className="w-5 h-5 rounded-[5px] bg-ink text-on-ink text-[0.58rem] flex items-center justify-center uppercase">{workspace.name.slice(0, 1)}</span>
          <span className="text-[0.8rem] font-medium truncate flex-1">{workspace.name}</span>
          <span className="h-5 px-1.5 rounded-[5px] bg-accent-soft text-accent-ink text-[0.62rem] font-medium flex items-center">{ROLE[user.role]}</span>
        </div>
        <nav className="flex flex-col gap-0.5 mt-0.5">
          <Row href={`${home}?view=all`} icon={LayoutGrid} label="All projects" on={isHome && view === "all"} />
          <Row href={`${home}?view=archived`} icon={Archive} label="Archived" on={isHome && view === "archived"} />
          <Row href={`${home}/usage`} icon={BarChart3} label="Usage" on={path === `${home}/usage`} />
        </nav>

        <Link href={`${home}/usage`} className="mt-3 flex items-center gap-2 border border-hairline rounded-[10px] px-3 py-2.5 hover:border-line">
          <span className="flex-1 min-w-0">
            <span className="block text-[0.76rem] font-medium">AI this month</span>
            <span className="block text-[0.7rem] text-ink-faint">{usage.used} generation{usage.used === 1 ? "" : "s"}{usage.cap ? ` of ${usage.cap}` : " · no cap set"}</span>
            {usage.cap ? (
              <span className="block h-1 rounded-full bg-field mt-1.5 overflow-hidden"><span className="block h-full bg-ink" style={{ width: `${Math.min(100, (usage.used / usage.cap) * 100)}%` }} /></span>
            ) : null}
          </span>
          <ChevronRight size={14} className="text-ink-faint" />
        </Link>
      </div>

      <div className="mx-3 my-3 h-px bg-hairline" />

      <div className="px-2 flex-1 overflow-y-auto">
        <p className="px-2.5 text-[0.76rem] font-medium text-ink-muted mb-1">Starred</p>
        {starred.length === 0 ? (
          <p className="px-2.5 text-[0.72rem] text-ink-faint leading-relaxed">Star a project from its ⋯ menu to pin it here.</p>
        ) : (
          starred.map((p) => (
            <Link key={p.id} href={`${home}/p/${p.id}`} className="flex items-center gap-2 h-8 px-2.5 rounded-[7px] text-[0.78rem] text-ink-muted hover:bg-field hover:text-ink">
              <Star size={13} className="fill-current text-accent" /> <span className="truncate">{p.name}</span>
            </Link>
          ))
        )}
      </div>

      <div className="p-2 space-y-2">
        <ThemeSwitch />
        {isAdmin ? (
          <Link href="/settings/workspaces" className="flex items-center justify-center gap-2 h-9 rounded-[8px] bg-ink text-on-ink text-[0.8rem] font-medium hover:opacity-90"><Users size={14} /> Invite &amp; manage access</Link>
        ) : (
          <Link href="/settings" className="flex items-center justify-center gap-2 h-9 rounded-[8px] border border-line text-[0.8rem] font-medium hover:border-ink"><Settings size={14} /> Settings</Link>
        )}
      </div>
    </aside>
  );
}
