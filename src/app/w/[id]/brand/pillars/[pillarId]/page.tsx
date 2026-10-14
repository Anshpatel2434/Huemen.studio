import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, CalendarDays, Compass, FileText, Lightbulb, Network, PenLine, Quote, Users } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { pillarDetail } from "@/lib/data/planning";
import { loadBriefAnswers, loadFoundation } from "@/lib/data/foundation";
import { formatByKey } from "@/lib/content/formats";
import { ANGLES } from "@/lib/content/angles";
import { FlowNode, FlowTree } from "@/components/flow-tree";
import { DraftFromPillar } from "./draft-button";

export const metadata = { title: "Pillar" };

const LEAF: Record<string, string> = { "b:angles": "Angle", "b:ideas": "Idea", "b:slots": "Slot", "b:pieces": "Piece" };

/**
 * One pillar as a connected map. Above it, what pillars are made from: the
 * brief and the strategy answers (pillars are generated from those, or added
 * by hand; which answer led to which pillar is not recorded, so the map says
 * "made from your brief" rather than claiming a line it can't show). Below
 * it, what grows from it: the angles it can be written from, the ideas
 * tagged to it, its calendar slots and the pieces written under it.
 */
export default async function PillarPage({ params }: PageProps<"/w/[id]/brand/pillars/[pillarId]">) {
  const { id, pillarId } = await params;
  const { scope } = await workspaceScope(id);
  const [detail, f, answers] = await Promise.all([pillarDetail(scope, pillarId), loadFoundation(scope), loadBriefAnswers(scope)]);
  if (!detail) notFound();
  const { pillar, ideas, slots, pieces } = detail;
  const base = `/w/${id}`;

  const sources = [
    f.niche.trim() && { id: "src:niche", label: "What you do", icon: <BookOpen size={12} aria-hidden="true" />, text: f.niche },
    f.audience.trim() && { id: "src:audience", label: "Who it's for", icon: <Users size={12} aria-hidden="true" />, text: f.audience },
    f.positioning.trim() && { id: "src:positioning", label: "Positioning", icon: <Compass size={12} aria-hidden="true" />, text: f.positioning },
    ...answers.slice(0, 3).map((a) => ({ id: `src:${a.key}`, label: a.question, icon: <Quote size={12} aria-hidden="true" />, text: a.answer })),
  ].filter(Boolean) as { id: string; label: string; icon: React.ReactNode; text: string }[];

  const branches = [
    { id: "b:angles", label: `Ways in · ${ANGLES.length}`, icon: <Compass size={12} aria-hidden="true" />, leaves: ANGLES.map((a, i) => ({ id: `angle:${i}`, body: <p className="text-sm">{a}</p> })), empty: "" },
    { id: "b:ideas", label: `Ideas · ${ideas.length}`, icon: <Lightbulb size={12} aria-hidden="true" />, leaves: ideas.map((i) => ({ id: `idea:${i.id}`, body: <p className="text-sm line-clamp-3">{i.text}</p> })), empty: "No ideas tagged yet", emptyHref: `${base}/plan/ideas`, emptyCta: "Capture one" },
    { id: "b:slots", label: `Calendar · ${slots.length}`, icon: <CalendarDays size={12} aria-hidden="true" />, leaves: slots.map((s) => ({ id: `slot:${s.id}`, body: <><p className="text-xs text-ink-faint num">{s.date}{s.channel ? ` · ${s.channel}` : ""}</p><p className="text-sm line-clamp-2 mt-0.5">{s.topic ?? "Untitled slot"}</p></> })), empty: "Nothing planned yet", emptyHref: `${base}/plan/calendar`, emptyCta: "Open the calendar" },
    { id: "b:pieces", label: `Pieces · ${pieces.length}`, icon: <PenLine size={12} aria-hidden="true" />, leaves: pieces.map((p) => ({ id: `piece:${p.id}`, body: <><p className="text-xs text-ink-faint">{formatByKey(p.format).label} · {p.status}</p>{p.projectId ? <Link href={`${base}/p/${p.projectId}/content`} className="text-sm line-clamp-3 mt-0.5 hover:underline underline-offset-2">{p.hook || "No copy yet"}</Link> : <p className="text-sm line-clamp-3 mt-0.5">{p.hook || "No copy yet"}</p>}</> })), empty: "Nothing written yet" },
  ];

  const edges = [
    ...(sources.length ? sources.map((s) => ({ from: s.id, to: "pillar", on: true })) : [{ from: "src:none", to: "pillar", on: true }]),
    ...branches.map((b) => ({ from: "pillar", to: b.id, on: b.leaves.length > 0 })),
    ...branches.flatMap((b) => {
      const ids = b.leaves.length ? b.leaves.map((l) => l.id) : [`${b.id}:empty`];
      return ids.map((leaf, i) => ({ from: i === 0 ? b.id : ids[i - 1], to: leaf, on: b.leaves.length > 0 }));
    }),
  ];

  return (
    <div className="absolute inset-0 overflow-auto canvas-dots">
      <div className="page py-8 flex flex-col gap-8">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div className="flex-1 min-w-[28ch]">
            <Link href={`${base}/brand/pillars`} className="inline-flex items-center gap-1.5 min-h-11 text-sm text-ink-muted hover:text-ink"><ArrowLeft size={14} aria-hidden="true" /> All pillars</Link>
            <p className="label-mono eyebrow mt-1">Pillar</p>
            <h1 className="text-3xl mt-2">{pillar.name}</h1>
            {pillar.description && <p className="text-ink-muted mt-2 max-w-[62ch]">{pillar.description}</p>}
          </div>
          <DraftFromPillar tenantId={id} name={pillar.name} />
        </div>

        <FlowTree edges={edges} className="flex flex-col items-center gap-12 pb-10 min-w-max">
          <div className="flex flex-col items-center gap-2">
            <p className="label-mono text-ink-faint">Made from your brief</p>
            <div className="flex flex-wrap justify-center gap-3 max-w-[1200px]">
              {sources.length ? sources.map((s) => (
                <FlowNode key={s.id} id={s.id} label={s.label} icon={s.icon} width="w-[220px]">
                  <p className="text-sm line-clamp-3">{s.text}</p>
                </FlowNode>
              )) : (
                <FlowNode id="src:none" label="Added by you" icon={<FileText size={12} aria-hidden="true" />} tone="ghost" width="w-[220px]">
                  <p className="text-sm">Fill in the brief and new pillars are generated from it.</p>
                </FlowNode>
              )}
            </div>
          </div>

          <FlowNode id="pillar" label="Pillar" icon={<Network size={12} aria-hidden="true" />} tone="on" width="w-[min(100%,360px)]" className="!border-ink">
            <p className="text-lg font-medium leading-snug">{pillar.name}</p>
            <p className="text-xs text-ink-faint mt-1 num">{ideas.length} ideas · {slots.length} slots · {pieces.length} pieces</p>
          </FlowNode>

          <div className="flex gap-6 items-start">
            {branches.map((b) => (
              <div key={b.id} className="flex flex-col items-center gap-6 w-[230px]">
                <FlowNode id={b.id} label={b.label} icon={b.icon} tone={b.leaves.length ? "on" : "ghost"} width="w-full" />
                {b.leaves.length ? b.leaves.map((l) => (
                  <FlowNode key={l.id} id={l.id} label={LEAF[b.id]} width="w-full">{l.body}</FlowNode>
                )) : (
                  <FlowNode id={`${b.id}:empty`} label={b.empty} tone="ghost" width="w-full">
                    {b.emptyHref ? <Link href={b.emptyHref} className="text-sm underline underline-offset-2">{b.emptyCta}</Link> : <p className="text-sm">Write a piece from this pillar to start.</p>}
                  </FlowNode>
                )}
              </div>
            ))}
          </div>
        </FlowTree>
      </div>
    </div>
  );
}
