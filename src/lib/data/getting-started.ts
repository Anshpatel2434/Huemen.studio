/**
 * Getting started: what the short onboarding left for later, as five tabs with
 * ticks (Obello-style). One place decides what "done" means, so the home
 * window, the home card and the /setup page always agree.
 *
 * Server-only.
 */
import "server-only";
import type { WorkspaceScope } from "./projects";
import type { VoicePack } from "@/lib/voice/types";
import { listPillars } from "./planning";
import { listConnections } from "./connections";

export const GUIDE_TABS = ["voice", "rules", "stories", "pillars", "connect"] as const;
export type GuideTab = (typeof GUIDE_TABS)[number];
export const isGuideTab = (v: unknown): v is GuideTab => typeof v === "string" && (GUIDE_TABS as readonly string[]).includes(v);

export interface GuideItem { label: string; done: boolean }
export interface GuideSection { key: GuideTab; tab: string; title: string; body: string; items: GuideItem[]; done: boolean }

export async function gettingStarted(scope: WorkspaceScope, pack: VoicePack): Promise<GuideSection[]> {
  const [pillars, connections] = await Promise.all([listPillars(scope), listConnections(scope).catch(() => [])]);
  const answered = new Set(pack.onboarding.answered ?? []);
  const has = (q: string) => answered.has(q);
  const id = pack.identity;
  const guard = (g: string) => !!pack.guardrails.find((x) => x.id === g)?.rule?.trim();

  const sections: Omit<GuideSection, "done">[] = [
    {
      key: "voice", tab: "Voice", title: "Tune your voice",
      body: "Pick between pairs of lines to set your dials, keep your four strongest words, and tell us how you talk when your guard is down.",
      items: [
        { label: "Set your dials", done: has("C4") || !!id.dials?.value },
        { label: "Keep your four words", done: (id.personalityWords?.value ?? []).length > 0 },
        { label: "Picture your reader", done: has("A2") },
        { label: "Your lines, guard up and down", done: has("C1") && has("C2") },
      ],
    },
    {
      key: "rules", tab: "Brand rules", title: "Set your brand rules",
      body: "The lines you don't cross, the words you'd never use, who you'd love to sound like, and the languages you write in. Every draft keeps to them.",
      items: [
        { label: "What you'd never say about yourself", done: has("D1") || guard("self-label") },
        { label: "What's off-limits", done: has("D2") || guard("off-limits") },
        { label: "Words you never use", done: has("E1") || pack.index.neverWords.length > 0 },
        { label: "Voices you admire, and avoid", done: ((id.influences?.value?.admire.length ?? 0) + (id.influences?.value?.avoid.length ?? 0)) > 0 },
        { label: "Your languages", done: !!id.languages?.value },
      ],
    },
    {
      key: "stories", tab: "Stories and facts", title: "Your stories, beliefs and facts",
      body: "Drafts argue from what you believe, retell the stories you already tell, and use only the facts you give them. Nothing is invented.",
      items: [
        { label: "What you believe", done: (id.beliefs?.value ?? []).length > 0 },
        { label: "Stories you tell", done: (id.stories?.value ?? []).length > 0 },
        { label: "Facts you can stand behind", done: (id.proofs?.value ?? []).length > 0 },
        { label: "The one idea", done: !!id.carries?.value?.trim() },
      ],
    },
    {
      key: "pillars", tab: "Pillars", title: "Shape your pillars",
      body: "The three to five themes you're known for. Every idea and every piece hangs off one, so your feed adds up to something.",
      items: [
        { label: "Pillars made", done: pillars.length > 0 },
        { label: "What you want to be known for", done: pillars.length >= 3 },
      ],
    },
    {
      key: "connect", tab: "More writing", title: "Add more writing",
      body: "The more of your real writing it reads, the closer every draft sounds. Connect an account, or add a few more pieces whenever you write them.",
      items: [
        { label: "Ten pieces read", done: pack.corpusStats.pieces >= 10 },
        { label: "Thirty pieces read", done: pack.corpusStats.pieces >= 30 },
        { label: "An account connected", done: connections.some((c) => c.status === "connected") },
      ],
    },
  ];
  return sections.map((s) => ({ ...s, done: s.items.every((i) => i.done) }));
}
