import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { workspaceScope } from "@/lib/auth/workspace";
import { listProjects } from "@/lib/data/projects";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { approvedSince } from "@/lib/data/training";
import { resumeStep } from "@/lib/data/onboarding";
import { listCalendar, listIdeas } from "@/lib/data/planning";
import { loadUsage } from "@/lib/data/insights";
import { FORMATS } from "@/lib/content/formats";
import { rescanDue } from "@/lib/voice/lifecycle";
import { coreCardFacts } from "@/lib/voice/core-card";
import { LATER_COOKIE, mustOnboard } from "../onboarding/gate";
import { ProjectsHome } from "./projects-home";
import { BrandHome, type BrandHomeProps } from "./brand-home";

export const metadata = { title: "Home" };

type View = "recents" | "all" | "archived";
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * `/w/[id]` is Brand home; `?view=recents|all|archived` is the library (the
 * file browser with filters). Both share the onboarding gate and the banners.
 */
export default async function WorkspaceHome({ params, searchParams }: PageProps<"/w/[id]">) {
  const { id } = await params;
  const { view, q, ready } = await searchParams;
  const { session, scope } = await workspaceScope(id);
  const v: View | null = view === "all" || view === "archived" || view === "recents" ? view : null;
  const [jar, pack] = await Promise.all([cookies(), loadPackForWorkspace(scope)]);
  // Every way in (invite, sign-in link, /dashboard) lands here first, so this
  // is the one place a client who hasn't set up their voice is sent to do it.
  if (mustOnboard(session, pack, id, jar.get(LATER_COOKIE)?.value)) {
    redirect(`/w/${id}/onboarding?step=${resumeStep(pack!.onboarding)}`);
  }
  const now = await requestTime();
  const [ws, projects, sinceScan] = await Promise.all([
    getWorkspace(scope),
    listProjects(scope, { archived: v === "archived" }),
    pack ? approvedSince(scope, pack.scannedAt) : Promise.resolve(0),
  ]);
  const due = pack ? rescanDue(pack, sinceScan, now) : null;
  const shared = {
    tenantId: id,
    workspaceName: ws?.name ?? "Workspace",
    showWhatsNew: jar.get("huemen_seen_projects")?.value !== "1",
    setupStep: pack && !pack.onboarding.completedAt ? resumeStep(pack.onboarding) : null,
    rescanDays: due?.due ? due.days : null,
    justFinished: ready === "1" && !!pack?.onboarding.completedAt,
  };

  if (v) {
    return (
      <ProjectsHome
        {...shared}
        projects={projects}
        view={v}
        initialQuery={typeof q === "string" ? q : ""}
        showHero={jar.get("huemen_hero")?.value !== "0" && v !== "archived"}
      />
    );
  }

  const today = new Date(now);
  const [ideas, slots, usage] = await Promise.all([
    listIdeas(scope),
    listCalendar(scope, iso(today), iso(new Date(now + 14 * 864e5))),
    loadUsage(scope),
  ]);
  const platform = pack?.onboarding.writeFor?.[0] ?? "linkedin";
  const props: BrandHomeProps = {
    ...shared,
    now,
    projects,
    core: pack ? coreCardFacts(pack, now) : null,
    format: FORMATS.find((f) => f.platform === platform)?.key ?? null,
    ideas: ideas.filter((i) => i.status !== "archived" && !i.projectId && !i.convertedTo),
    upcoming: slots.filter((s) => !s.contentItemId && s.topic),
    usage: {
      text: usage.textThisMonth,
      images: usage.imagesThisMonth,
      textCap: usage.caps.textHard,
      imageCap: usage.caps.imageHard,
      resets: new Date(today.getFullYear(), today.getMonth() + 1, 1).toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
    },
  };
  return <BrandHome {...props} />;
}

/** One clock for the whole render, read outside it (render stays pure). */
async function requestTime(): Promise<number> {
  return Date.now();
}
