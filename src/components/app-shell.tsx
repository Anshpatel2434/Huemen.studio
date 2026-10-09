"use client";

/**
 * The app shell (design system §14): one frame for every workspace page.
 *
 *   sidebar   account and workspace switcher, search, the studio (Recents,
 *             Create, Check, Brand core, Plan), the workspace (Library,
 *             Archived, Usage), AI this month, Starred, appearance, access
 *   top bar   breadcrumbs, the section's own actions, the theme toggle, and
 *             the section's tabs underneath
 *
 * Navigation never disappears at a breakpoint, it changes shape: below 900px
 * the sidebar becomes a drawer behind a menu button in the top bar.
 *
 * The project editor is the one place without it: a canvas tool needs the
 * width, so it is the shell's focus mode, with its own top bar built from the
 * same components and a file menu that reaches every section (p/[pid]/shell).
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown, Clock, LayoutGrid, BarChart3, Settings, Users, LogOut, Plus, Search, Archive, Star, ChevronRight,
  PenLine, ScanText, Fingerprint, CalendarDays, Menu as MenuIcon, X,
} from "lucide-react";
import { Avatar, IconButton, LogoMark, Menu, MenuItem, MenuSeparator, ToastProvider } from "@/components/ui";
import { ThemeSwitch, ThemeToggle } from "@/components/theme";
import { PageTransition } from "@/components/page-transition";
import { signOutAction } from "@/app/dashboard/actions";

const ROLE: Record<string, string> = { owner_admin: "Admin", coach: "Coach", client: "Client" };

export interface ShellNav {
  workspace: { id: string; name: string };
  workspaces: { id: string; name: string }[];
  user: { email: string; role: string };
  isAdmin: boolean;
  starred: { id: string; name: string }[];
  usage: { used: number; cap: number | null };
}

export interface ShellTab { href: string; label: string; exact?: boolean }

const tabOn = (t: ShellTab, path: string) => (t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`));

export function AppShell({ nav, section, tabs, actions, children }: {
  nav: ShellNav;
  /** The section's name in the breadcrumb ("Brand core"). Home and Usage name themselves. */
  section?: string;
  tabs?: ShellTab[];
  /** Section-level actions, right of the breadcrumb (e.g. "Finish later"). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);

  // The drawer closes when the route changes (adjusted during render, not in an
  // effect), and on Escape, handing focus back.
  const [drawerPath, setDrawerPath] = useState(path);
  if (drawerPath !== path) { setDrawerPath(path); setDrawer(false); }
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDrawer(false); menuBtn.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <ToastProvider>
      <div className="h-dvh flex bg-ground">
        <aside className="hidden min-[900px]:flex w-[264px] shrink-0 border-r border-hairline bg-paper flex-col" aria-label="Main">
          <Sidebar nav={nav} />
        </aside>

        {drawer && (
          <div className="fixed inset-0 min-[900px]:hidden" style={{ zIndex: "var(--z-modal)" }}>
            <div className="absolute inset-0 bg-[var(--scrim)] fade-in" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-[300px] max-w-[86vw] bg-paper border-r border-hairline flex flex-col shadow-[var(--shadow-overlay)] pop" aria-label="Main" role="dialog" aria-modal="true">
              <div className="flex justify-end px-2 pt-2">
                <IconButton label="Close menu" onClick={() => setDrawer(false)}><X size={18} /></IconButton>
              </div>
              <Sidebar nav={nav} />
            </aside>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="shrink-0 bg-paper border-b border-hairline">
            <div className="min-h-14 flex items-center gap-2 px-3 min-[900px]:px-5">
              <button
                ref={menuBtn}
                type="button"
                onClick={() => setDrawer(true)}
                aria-label="Open menu"
                aria-expanded={drawer}
                className="hu-iconbtn min-[900px]:!hidden"
              >
                <MenuIcon size={19} />
              </button>
              <Crumbs nav={nav} section={section} tabs={tabs} />
              <span className="flex-1" />
              {actions}
              <ThemeToggle />
            </div>
            {tabs && tabs.length > 0 && (
              <nav className="hu-tabs !border-b-0 px-2 min-[900px]:px-3 overflow-x-auto !flex-nowrap" aria-label={section ?? "Section"}>
                {tabs.map((t) => (
                  <Link key={t.href} href={t.href} aria-current={tabOn(t, path) ? "page" : undefined} className="hu-tab">{t.label}</Link>
                ))}
              </nav>
            )}
          </header>
          <main className="flex-1 min-h-0 relative">
            <PageTransition level="page">{children}</PageTransition>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}

/** Where you are: workspace, section, then the tab or view you're on. */
function Crumbs({ nav, section, tabs }: { nav: ShellNav; section?: string; tabs?: ShellTab[] }) {
  const path = usePathname();
  const params = useSearchParams();
  const home = `/w/${nav.workspace.id}`;
  const view = params.get("view");
  const here: { label: string; href?: string }[] = [];
  if (path === home) here.push({ label: view === "all" ? "Library" : view === "archived" ? "Archived" : "Recents" });
  else if (path === `${home}/usage`) here.push({ label: "Usage" });
  else if (section) {
    const tab = tabs?.find((t) => tabOn(t, path));
    if (tab) here.push({ label: section, href: tabs![0].href }, { label: tab.label });
    else here.push({ label: section });
  }
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="hu-crumbs">
        <li className="min-w-0 flex"><Link href={home} className="truncate max-w-[22ch]">{nav.workspace.name}</Link></li>
        {here.map((c, i) => (
          <li key={c.label} className="min-w-0 flex items-center gap-2">
            <span className="sep" aria-hidden="true">/</span>
            {c.href && i < here.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function NavItem({ href, icon: Icon, label, on }: { href: string; icon: typeof Clock; label: string; on: boolean }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className="hu-navitem">
      <Icon size={17} aria-hidden="true" /> <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}

/** The sidebar: every item the old home sidebar had, at the system's 44px. */
function Sidebar({ nav }: { nav: ShellNav }) {
  const { workspace, workspaces, user, isAdmin, starred, usage } = nav;
  const path = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") ?? "recents";
  const [account, setAccount] = useState(false);
  const [q, setQ] = useState(params.get("q") ?? "");
  const home = `/w/${workspace.id}`;
  const isHome = path === home;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-3 pb-3">
      {/* Wordmark */}
      <Link href={home} className="flex items-center gap-2.5 min-h-14 px-1 shrink-0" aria-label={`Huemen.studio, ${workspace.name} home`}>
        <LogoMark size={26} />
        <span className="text-base font-semibold tracking-[-0.01em]">Huemen<span className="text-ink-faint">.studio</span></span>
      </Link>

      {/* Account and workspace switcher */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setAccount((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={account}
          className="w-full flex items-center gap-2.5 min-h-12 px-2 rounded-sm border border-hairline hover:border-line transition-colors"
        >
          <Avatar seed={workspace.id} label={workspace.name} size="sm" square />
          <span className="flex-1 min-w-0 text-left">
            <span className="block text-sm font-medium truncate">{workspace.name}</span>
            <span className="block text-xs text-ink-faint truncate">{user.email} · {ROLE[user.role] ?? user.role}</span>
          </span>
          <ChevronDown size={15} className="text-ink-faint shrink-0" aria-hidden="true" />
        </button>
        {account && (
          <>
            <div className="fixed inset-0" style={{ zIndex: "var(--z-dropdown)" }} onClick={() => setAccount(false)} />
            <Menu label="Account and workspaces" className="absolute left-0 right-0 top-[52px] pop">
              <div className="px-3 pt-1 pb-2">
                <p className="text-sm font-medium truncate">{user.email}</p>
                <p className="text-xs text-ink-faint">{ROLE[user.role] ?? user.role}</p>
              </div>
              <MenuSeparator />
              <p className="label-mono text-ink-faint px-3 pt-1 pb-1">Workspaces</p>
              <div className="max-h-64 overflow-y-auto flex flex-col gap-px">
                {workspaces.map((w) => (
                  <MenuItem key={w.id} href={`/w/${w.id}`} checked={w.id === workspace.id} icon={<Avatar seed={w.id} label={w.name} size="sm" square className="!w-6 !h-6 !text-[10px]" />}>
                    {w.name}
                  </MenuItem>
                ))}
              </div>
              <MenuSeparator />
              {isAdmin && <MenuItem href="/settings/workspaces" icon={<Plus size={15} aria-hidden="true" />}>New workspace</MenuItem>}
              <MenuItem href="/settings" icon={<Settings size={15} aria-hidden="true" />}>Settings</MenuItem>
              <form action={signOutAction}>
                <button type="submit" role="menuitem" className="hu-menu__item"><LogOut size={15} aria-hidden="true" /> Sign out</button>
              </form>
            </Menu>
          </>
        )}
      </div>

      {/* Search: finds projects in the library */}
      <form
        role="search"
        className="mt-3 shrink-0"
        onSubmit={(e) => { e.preventDefault(); router.push(`${home}?view=all${q ? `&q=${encodeURIComponent(q)}` : ""}`); }}
      >
        <label className="flex items-stretch gap-2 h-11 px-3 rounded-sm bg-hover border border-transparent focus-within:border-line text-ink-faint">
          <Search size={15} aria-hidden="true" className="self-center shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" className="bg-transparent outline-none text-sm text-ink flex-1 min-w-0 self-stretch -my-px placeholder:text-ink-faint" />
        </label>
      </form>

      {/* The studio (§14: Brand core, Create, Check, Library) */}
      <p className="hu-navgroup">Studio</p>
      <nav className="flex flex-col gap-0.5 shrink-0" aria-label="Studio">
        <NavItem href={home} icon={Clock} label="Recents" on={isHome && view === "recents"} />
        <NavItem href={`${home}/create`} icon={PenLine} label="Create" on={path.startsWith(`${home}/create`)} />
        <NavItem href={`${home}/check`} icon={ScanText} label="Check" on={path.startsWith(`${home}/check`)} />
        <NavItem href={`${home}/brand`} icon={Fingerprint} label="Brand core" on={path.startsWith(`${home}/brand`) || path.startsWith(`${home}/onboarding`)} />
        <NavItem href={`${home}/plan`} icon={CalendarDays} label="Plan" on={path.startsWith(`${home}/plan`)} />
      </nav>

      {/* The workspace */}
      <p className="hu-navgroup flex items-center gap-2">
        <span className="truncate">{workspace.name}</span>
        <span className="ml-auto shrink-0 normal-case tracking-normal font-sans text-xs font-medium px-2 py-0.5 rounded-full bg-accent-soft text-accent-ink">{ROLE[user.role]}</span>
      </p>
      <nav className="flex flex-col gap-0.5 shrink-0" aria-label="Workspace">
        <NavItem href={`${home}?view=all`} icon={LayoutGrid} label="Library" on={isHome && view === "all"} />
        <NavItem href={`${home}?view=archived`} icon={Archive} label="Archived" on={isHome && view === "archived"} />
        <NavItem href={`${home}/usage`} icon={BarChart3} label="Usage" on={path === `${home}/usage`} />
      </nav>

      {/* AI this month */}
      <Link href={`${home}/usage`} className="mt-3 shrink-0 flex items-center gap-2 border border-hairline rounded-md px-3 py-3 hover:border-line transition-colors">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium">AI this month</span>
          <span className="block text-xs text-ink-faint mt-0.5"><span className="num">{usage.used}</span> generation{usage.used === 1 ? "" : "s"}{usage.cap ? <> of <span className="num">{usage.cap}</span></> : " · no cap set"}</span>
          {usage.cap ? (
            <span className="block h-1.5 rounded-full bg-active mt-2 overflow-hidden" role="progressbar" aria-label="AI used this month" aria-valuemin={0} aria-valuemax={usage.cap} aria-valuenow={usage.used}>
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (usage.used / usage.cap) * 100)}%` }} />
            </span>
          ) : null}
        </span>
        <ChevronRight size={15} className="text-ink-faint" aria-hidden="true" />
      </Link>

      {/* Starred */}
      <p className="hu-navgroup">Starred</p>
      <div className="flex flex-col gap-0.5">
        {starred.length === 0 ? (
          <p className="px-3 text-xs text-ink-faint leading-relaxed">Star a project from its ⋯ menu to pin it here.</p>
        ) : (
          starred.map((p) => (
            <Link key={p.id} href={`${home}/p/${p.id}`} aria-current={path.startsWith(`${home}/p/${p.id}`) ? "page" : undefined} className="hu-navitem">
              <Star size={15} className="fill-current text-accent" aria-hidden="true" /> <span className="truncate">{p.name}</span>
            </Link>
          ))
        )}
      </div>

      <span className="flex-1 min-h-4" />

      {/* Appearance and access */}
      <div className="flex flex-col gap-2 pt-3 border-t border-hairline shrink-0">
        <ThemeSwitch />
        {isAdmin ? (
          <Link href="/settings/workspaces" className="inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-full bg-ink text-on-ink text-sm font-medium hover:opacity-90"><Users size={15} aria-hidden="true" /> Invite &amp; manage access</Link>
        ) : (
          <Link href="/settings" aria-current={path.startsWith("/settings") ? "page" : undefined} className="hu-navitem justify-center border border-line !rounded-full"><Settings size={15} aria-hidden="true" /> Settings</Link>
        )}
      </div>
    </div>
  );
}
