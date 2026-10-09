import { workspaceScope } from "@/lib/auth/workspace";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { confidence } from "@/lib/voice/derive";
import { CheckDesk } from "./check-desk";

export const metadata = { title: "Check" };

export default async function CheckPage({ params }: PageProps<"/w/[id]/check">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);
  const conf = pack ? confidence(pack) : null;
  const platforms = pack?.onboarding.writeFor?.length ? pack.onboarding.writeFor : ["linkedin"];

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="max-w-[880px] mx-auto px-5 sm:px-8 py-8 flex flex-col gap-6">
        <div>
          <p className="label-mono eyebrow">Check</p>
          <h1 className="text-3xl mt-2">Does this sound like <span className="serif-accent">you?</span></h1>
          <p className="text-ink-muted mt-2 max-w-[62ch]">
            Paste anything: a draft from here, one you wrote yourself, or one someone wrote for you. You'll see how close it is to your voice and what to change. It never stops you publishing.
          </p>
        </div>
        <CheckDesk tenantId={id} platforms={platforms} confidence={conf ? { score: conf.score, missing: conf.missing } : null} />
      </div>
    </div>
  );
}
