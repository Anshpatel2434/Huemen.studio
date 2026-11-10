import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { LogoMark } from "@/components/ui";
import { StageChips } from "@/components/stage-chips";
import { IntakeForm } from "./intake-form";

export const metadata = { title: "Intake" };

export default async function IntakePage({ params }: PageProps<"/w/[id]/brand/intake">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 flex items-center justify-between px-4">
        <Link href={`/w/${id}`} className="p-1 rounded-sm hover:bg-field"><LogoMark size={26} /></Link>
        <Link href={`/w/${id}/brand`} className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft size={14} /> Open {(ws?.name ?? "Your brand")}</Link>
      </header>
      <main className="flex-1 flex flex-col items-center px-5 pt-10 pb-20">
        <StageChips active="brief" />
        <h1 className="text-center text-3xl leading-[1.1] mt-7 max-w-2xl fade-up">
          Dump in everything you&apos;ve got.
          <br />
          <span className="serif-accent">We&apos;ll turn it into a brief.</span>
        </h1>
        <p className="text-center text-ink-muted mt-4 max-w-lg leading-relaxed fade-up">
          Workshop notes, a call transcript, questionnaire answers, an old bio. Label what you can
          (<span className="text-ink">Niche:</span>, <span className="text-ink">Audience:</span>, <span className="text-ink">Don&apos;t words:</span>) and it lands in the right place.
        </p>
        <p className="label-mono text-ink-faint mt-3">{(ws?.name ?? "Your brand")} · Brief</p>
        <IntakeForm tenantId={id} />
      </main>
    </div>
  );
}
