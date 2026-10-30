"use client";

/**
 * The agent's answer components, drawn: one renderer per component in
 * spec.ts, styled from Huemen's theme tokens. The list, descriptions and props
 * all come from the spec, so the panel can only draw what the model was told
 * about. Buttons raise fixed actions (see spec.ts); the panel decides what
 * runs, and the server checks again.
 */
import "./no-devtools";
import { createLibrary, defineComponent, useIsStreaming, useRenderNode, useTriggerAction, type ComponentRenderer } from "@openuidev/react-lang";
import { ArrowUpRight, Check, Lightbulb, PenLine, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { FORMATS } from "@/lib/content/formats";
import { COMPONENT_GROUPS, COMPONENT_NAMES, DESCRIPTIONS, PAGES, PROPS, type AgentAction, type ComponentName, type PropsOf } from "./spec";

const formatLabel = (key: string) => FORMATS.find((f) => f.key === key)?.label ?? key;

// ---- Small building blocks --------------------------------------------------------

function ActionPill({ children: label, onClick, icon }: { children: ReactNode; onClick: () => void; icon?: ReactNode }) {
  const streaming = useIsStreaming();
  return (
    <button
      type="button"
      disabled={streaming}
      onClick={onClick}
      className="hu-hit inline-flex items-center gap-1 self-start rounded-full border border-line px-3 h-8 text-xs font-medium hover:bg-hover hover:border-line-strong disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

/** Fires one fixed action: the message is what the conversation shows. */
function useAct() {
  const trigger = useTriggerAction();
  return (message: string, action: AgentAction) => trigger(message, undefined, action);
}

function Children({ nodes, className }: { nodes: unknown; className: string }) {
  const render = useRenderNode();
  return <div className={className}>{render(nodes)}</div>;
}

// ---- Renderers ----------------------------------------------------------------------

type View<N extends ComponentName> = (p: { props: PropsOf<N> }) => ReactNode;

const VIEWS: { [N in ComponentName]: View<N> } = {
  Answer: ({ props }) => <Children nodes={props.children} className="flex flex-col gap-3 text-sm leading-relaxed" />,
  Heading: ({ props }) => <p className="text-sm font-semibold">{props.text}</p>,
  Para: ({ props }) => <p>{props.text}</p>,
  Bullets: ({ props }) => (
    <ul className="flex flex-col gap-1 pl-4 list-disc marker:text-ink-faint">
      {(props.items ?? []).map((t, i) => <li key={i}>{t}</li>)}
    </ul>
  ),
  Note: ({ props }) => (
    <p className={`rounded-md px-2.5 py-2 text-xs ${props.tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-ink"}`}>{props.text}</p>
  ),
  ScoreBar: ({ props }) => {
    const v = Math.max(0, Math.min(100, Math.round(props.score ?? 0)));
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between text-xs"><span className="font-medium">{props.label}</span><span className="tabular-nums text-ink-muted">{v}</span></div>
        <div className="h-1.5 rounded-full bg-field overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={props.label}>
          <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${v}%` }} />
        </div>
        {props.note && <p className="text-xs text-ink-faint">{props.note}</p>}
      </div>
    );
  },
  Checklist: ({ props }) => <Children nodes={props.children} className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-md" />,
  CheckItem: function CheckItemView({ props }) {
    const act = useAct();
    const target = props.page ? PAGES[props.page] : undefined;
    return (
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center ${props.done ? "bg-ink text-on-ink" : "border border-line"}`}>{props.done && <Check size={11} aria-hidden="true" />}</span>
        <span className={`flex-1 text-xs ${props.done ? "text-ink-faint line-through" : ""}`}>{props.label}</span>
        {!props.done && props.page && target && (
          <button type="button" onClick={() => act(`Open ${target.label}`, { type: "open", params: { page: props.page! } })} className="hu-hit text-xs text-accent-ink inline-flex items-center gap-0.5">
            Fix <ArrowUpRight size={12} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  },
  IdeaCard: function IdeaCardView({ props }) {
    const act = useAct();
    return (
      <div className="flex flex-col gap-1.5 border border-hairline rounded-md p-2.5">
        <p className="text-xs text-ink-faint">{formatLabel(props.format)}{props.pillar ? ` · ${props.pillar}` : ""}</p>
        <p className="font-medium leading-snug">{props.title}</p>
        {props.why && <p className="text-xs text-ink-muted">{props.why}</p>}
        <ActionPill icon={<PenLine size={12} aria-hidden="true" />} onClick={() => act(`Draft: ${props.title}`, { type: "draft_piece", params: { format: props.format, topic: props.title, pillar: props.pillar } })}>Draft this</ActionPill>
      </div>
    );
  },
  WeekPlan: ({ props }) => <Children nodes={props.children} className="flex flex-col gap-2" />,
  PlanSlot: function PlanSlotView({ props }) {
    const act = useAct();
    return (
      <div className="flex gap-2.5 border border-hairline rounded-md p-2.5">
        <span className="w-9 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted pt-0.5">{props.day}</span>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <p className="font-medium leading-snug">{props.title}</p>
          <p className="text-xs text-ink-faint">{formatLabel(props.format)}{props.pillar ? ` · ${props.pillar}` : ""}</p>
          <ActionPill icon={<PenLine size={12} aria-hidden="true" />} onClick={() => act(`Draft: ${props.title}`, { type: "draft_piece", params: { format: props.format, topic: props.title, pillar: props.pillar } })}>Draft</ActionPill>
        </div>
      </div>
    );
  },
  PillarCard: function PillarCardView({ props }) {
    const act = useAct();
    return (
      <div className="flex flex-col gap-1.5 border border-hairline rounded-md p-2.5">
        <p className="font-medium">{props.name}</p>
        {props.description && <p className="text-xs text-ink-muted">{props.description}</p>}
        {props.suggested && (
          <ActionPill icon={<Plus size={12} aria-hidden="true" />} onClick={() => act(`Add pillar: ${props.name}`, { type: "add_pillar", params: { name: props.name, description: props.description } })}>Add pillar</ActionPill>
        )}
      </div>
    );
  },
  HookOptions: function HookOptionsView({ props }) {
    const act = useAct();
    return (
      <div className="flex flex-col gap-1.5">
        {(props.hooks ?? []).map((h, i) => (
          <div key={i} className="flex items-start gap-2 border border-hairline rounded-md p-2.5">
            <p className="flex-1">{h}</p>
            <button type="button" aria-label="Save to ideas" title="Save to ideas" onClick={() => act(`Save idea: ${h}`, { type: "capture_idea", params: { text: h } })} className="hu-iconbtn shrink-0"><Lightbulb size={14} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    );
  },
  OpenPage: function OpenPageView({ props }) {
    const act = useAct();
    if (!PAGES[props.page]) return null;
    return <ActionPill icon={<ArrowUpRight size={12} aria-hidden="true" />} onClick={() => act(props.label, { type: "open", params: { page: props.page } })}>{props.label}</ActionPill>;
  },
  FollowUps: function FollowUpsView({ props }) {
    const act = useAct();
    return (
      <div className="flex flex-wrap gap-1.5">
        {(props.questions ?? []).slice(0, 3).map((q, i) => (
          <ActionPill key={i} onClick={() => act(q, { type: "ask", params: { text: q } })}>{q}</ActionPill>
        ))}
      </div>
    );
  },
};

export const agentLibrary = createLibrary({
  root: "Answer",
  components: COMPONENT_NAMES.map((name) =>
    defineComponent({ name, description: DESCRIPTIONS[name], props: PROPS[name], component: VIEWS[name] as unknown as ComponentRenderer<PropsOf<typeof name>> }),
  ),
  componentGroups: COMPONENT_GROUPS,
});
