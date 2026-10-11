import { workspaceScope } from "@/lib/auth/workspace";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { coreCardFacts } from "@/lib/voice/core-card";
import { CheckDesk } from "./check-desk";

export const metadata = { title: "Check" };

export default async function CheckPage({ params }: PageProps<"/w/[id]/check">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);
  const core = pack ? coreCardFacts(pack, await requestTime()) : null;
  const platforms = pack?.onboarding.writeFor?.length ? pack.onboarding.writeFor : ["linkedin"];

  return (
    <CheckDesk
      tenantId={id}
      platforms={platforms}
      core={core && { name: core.name, seed: core.seed, confidence: core.confidence, missing: core.missing, attributes: core.attributes, trained: core.trained }}
      intro={
        <div>
          <p className="label-mono eyebrow">Check</p>
          <h1 className="text-3xl mt-2">Does this sound like <span className="serif-accent">you?</span></h1>
          <p className="text-ink-muted mt-2 max-w-[62ch]">
            Paste anything: a draft from here, one you wrote yourself, or one someone wrote for you. You&apos;ll see how close it is to your voice and what to change. It never stops you publishing.
          </p>
        </div>
      }
    />
  );
}

/** The clock, read outside render. */
async function requestTime(): Promise<number> {
  return Date.now();
}
