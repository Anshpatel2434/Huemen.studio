import { redirect } from "next/navigation";
import { workspaceScope } from "@/lib/auth/workspace";
import { firstPieceStale } from "@/lib/voice/lifecycle";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { loadFoundation, loadVisualIdentity } from "@/lib/data/foundation";
import { listContent } from "@/lib/data/content";
import { checkText } from "@/lib/data/check";
import { getProject } from "@/lib/data/projects";
import { listAssets } from "@/lib/data/assets";
import { isScreen, resumeScreen, SCREENS, screenForLegacyStep, screenIndex, type ScreenKey } from "@/lib/onboarding/screens";
import { OnboardingDrafts } from "./draft";
import { UrlImport } from "./enrich-ui";
import { AudienceScreen, DraftScreen, LookScreen, NameScreen, SiteScreen, WordsScreen, WritingScreen } from "./short-flow";

export const metadata = { title: "Set up your voice" };

/** A site's description is a paragraph; "what do you do" wants its first line. */
const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s+/)[0] ?? "").slice(0, 160);
export const dynamic = "force-dynamic";

/**
 * Onboarding, the short way: seven screens, one question each (Obello-style).
 * Website → name → audience → writing → look → words → first piece. The
 * deeper questions wait in Getting started (`/w/[id]/setup`).
 *
 * The URL names the screen (`?s=`), so a reload stays put; a bare URL, or a
 * screen not reached yet, resumes at the furthest one reached. Older `?step=`
 * links land on the matching screen.
 */
export default async function OnboardingPage({ params, searchParams }: PageProps<"/w/[id]/onboarding">) {
  const { id } = await params;
  const sp = await searchParams;
  const { session, scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);
  if (!pack) {
    return (
      <div className="absolute inset-0 overflow-y-auto">
        <div className="page py-12"><div className="max-w-3xl">
          <h1 className="text-3xl">A voice belongs to a person.</h1>
          <p className="text-ink-muted mt-2">Sign in as the person whose brand this is and their voice pack will be created for them.</p>
        </div></div>
      </div>
    );
  }

  const reached = resumeScreen(pack.onboarding);
  const asked: ScreenKey | null = isScreen(sp.s)
    ? sp.s
    : typeof sp.step === "string" && /^\d$/.test(sp.step) ? screenForLegacyStep(Number(sp.step)) : null;
  if (!asked || screenIndex(asked) > reached) redirect(`/w/${id}/onboarding?s=${SCREENS[reached]}`);
  const at = asked;

  return <OnboardingDrafts prefix={`huemen:onb:${pack.id}`}>{await screen()}</OnboardingDrafts>;

  async function screen() {
    const p = pack!;
    const site = p.onboarding.site ?? null;
    switch (at) {
      case "site":
        return <SiteScreen tenantId={id} found={site} />;

      case "name":
      case "audience": {
        const f = await loadFoundation(scope);
        // A new pack is named after the email address; that's not a name to sign with.
        const name = p.displayName.toLowerCase() === session.email.toLowerCase() ? "" : p.displayName;
        return at === "name"
          ? <NameScreen tenantId={id} saved={{ name, niche: f.niche }} suggested={{ name: site?.title ?? "", niche: firstSentence(site?.description ?? "") }} />
          : <AudienceScreen tenantId={id} saved={{ audience: f.audience, offers: f.offers, positioning: f.positioning }} />;
      }

      case "writing":
        return (
          <WritingScreen
            tenantId={id}
            sources={p.onboarding.sources ?? []}
            writeFor={p.onboarding.writeFor ?? []}
            pieces={p.corpusStats.pieces}
            words={p.corpusStats.words}
            links={<UrlImport tenantId={id} />}
          />
        );

      case "look": {
        const [v, assets] = await Promise.all([loadVisualIdentity(scope), listAssets(scope)]);
        return (
          <LookScreen
            tenantId={id}
            references={assets.filter((a) => a.kind === "reference_image").map((a) => ({ id: a.id, url: a.url }))}
            palette={v.palette}
            site={site?.url ?? null}
          />
        );
      }

      case "words":
        return <WordsScreen tenantId={id} saved={p.identity.personalityLonglist?.value ?? []} />;

      case "draft": {
        const firstId = p.onboarding.firstProjectId;
        const first = firstId ? await getProject(scope, firstId) : null;
        const draft = first ? (await listContent({ ...scope, projectId: first.id }))[0] ?? null : null;
        const check = draft
          ? await checkText(scope, [draft.hook, draft.body, draft.cta].filter(Boolean).join("\n\n"), first?.channel ?? "linkedin", { copyCheck: true }).catch(() => null)
          : null;
        const fp = p.onboarding.firstPiece;
        return (
          <DraftScreen
            tenantId={id}
            name={p.displayName.includes("@") ? "" : p.displayName}
            first={first && { id: first.id, hook: draft?.hook ?? null, body: draft?.body ?? null, cta: draft?.cta ?? null, score: check?.score ?? null, band: check?.band ?? null }}
            state={fp?.state === "writing" && !firstPieceStale(fp, Date.now()) ? "writing" : fp?.state === "writing" || fp?.state === "failed" ? (draft ? null : "failed") : null}
          />
        );
      }
    }
  }
}
