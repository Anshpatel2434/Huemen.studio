/**
 * The stand-in's agent answers (no key, no network). Real OpenUI Lang, built
 * only from the brand context block and the task (INV-2), so the panel, the
 * parser and every button can be exercised end to end in development and CI.
 * agent-ui.test.ts checks every branch parses cleanly against agentLibrary.
 */
import type { BrandContext } from "@/lib/context/context-builder";

const q = (s: string) => JSON.stringify(s);
const list = (xs: string[]) => `[${xs.map(q).join(", ")}]`;

function pillarsOf(serialized: string): { name: string; description: string }[] {
  const block = serialized.split(/^Content pillars:\s*$/m)[1];
  if (!block) return [];
  const out: { name: string; description: string }[] = [];
  for (const line of block.split("\n").slice(1)) {
    const m = line.match(/^ {2}- ([^:]+?)(?::\s*(.+))?$/);
    if (!m) break;
    out.push({ name: m[1].trim(), description: (m[2] ?? "").trim() });
  }
  return out;
}

const field = (serialized: string, label: string) => serialized.match(new RegExp(`^${label}: (.+)$`, "m"))?.[1]?.trim() ?? "";

export function mockAgentAnswer(context: BrandContext, taskInput: string): string {
  const question = taskInput.match(/^Question: (.+)$/m)?.[1]?.trim() ?? "";
  const s = context.serialized;
  const niche = field(s, "Niche") || "your field";
  const pillars = pillarsOf(s);
  const pick = (i: number) => pillars[i % Math.max(1, pillars.length)]?.name;
  const lines: string[] = [];

  if (/\b(plan|week|schedule|calendar)\b/i.test(question)) {
    const days = ["Mon", "Wed", "Fri"];
    const topics = [`The mistake most people make with ${niche}`, `A story from the work this month`, `What I would do differently starting out`];
    lines.push(`root = Answer([h, p, plan, more])`);
    lines.push(`h = Heading("Your week, three posts")`);
    lines.push(`p = Para(${q(pillars.length ? `One post per pillar, so ${pillars.slice(0, 3).map((x) => x.name).join(", ")} each get a turn.` : "Three posts to keep a steady rhythm. Add pillars and I will spread them across those.")})`);
    lines.push(`plan = WeekPlan([${days.map((_, i) => `s${i}`).join(", ")}])`);
    days.forEach((d, i) => {
      const pillar = pick(i);
      lines.push(`s${i} = PlanSlot(${q(d)}, ${q(topics[i])}, ${q(i === 1 ? "ig_carousel" : "linkedin_post")}${pillar ? `, ${q(pillar)}` : ""})`);
    });
    lines.push(`more = FollowUps(${list(["Give me hooks for Monday", "What is missing from my brief?"])})`);
    return lines.join("\n");
  }

  if (/\b(hooks?|opening|opener)\b/i.test(question)) {
    lines.push(`root = Answer([h, hooks, tip, more])`);
    lines.push(`h = Heading("Five ways to open")`);
    lines.push(
      `hooks = HookOptions(${list([
        `Most advice about ${niche} is wrong. Here is what works.`,
        `I got ${niche} wrong for three years.`,
        `One number changed how I think about ${niche}.`,
        `Nobody tells you this part of ${niche}.`,
        `Here is the question every client asks me first.`,
      ])})`,
    );
    lines.push(`tip = Note("Save the ones that sound like you; they land in the idea inbox.", "tip")`);
    lines.push(`more = FollowUps(${list(["Turn the first one into a post", "Plan my week"])})`);
    return lines.join("\n");
  }

  if (/\bpillars?\b/i.test(question)) {
    const ids = pillars.slice(0, 3).map((_, i) => `p${i}`);
    lines.push(`root = Answer([h, ${[...ids, "n0"].join(", ")}, more])`);
    lines.push(`h = Heading(${q(pillars.length ? "Your pillars, and one to add" : "Start with these pillars")})`);
    pillars.slice(0, 3).forEach((p, i) => lines.push(`p${i} = PillarCard(${q(p.name)}, ${q(p.description || "One of your pillars.")})`));
    lines.push(`n0 = PillarCard("Behind the work", "Your process made visible: how a client goes from first call to result.", true)`);
    lines.push(`more = FollowUps(${list(["Plan my week", "What should I write next?"])})`);
    return lines.join("\n");
  }

  if (/\b(write|post|idea|ideas|next|draft)\b/i.test(question)) {
    const ideas = [
      { t: `The mistake most people make with ${niche}`, f: "linkedin_post", why: "A clear point of view, easy to argue with." },
      { t: "A client story from this month", f: "linkedin_post", why: "Proof in your own words beats any claim." },
      { t: `Three things I would tell someone new to ${niche}`, f: "ig_carousel", why: "One idea per slide." },
    ];
    lines.push(`root = Answer([h, ${ideas.map((_, i) => `i${i}`).join(", ")}, more])`);
    lines.push(`h = Heading("Three posts worth writing next")`);
    ideas.forEach((x, i) => {
      const pillar = pick(i);
      lines.push(`i${i} = IdeaCard(${q(x.t)}, ${q(x.f)}${pillar ? `, ${q(pillar)}` : ", null"}, ${q(x.why)})`);
    });
    lines.push(`more = FollowUps(${list(["Plan my week", "Give me hooks for the first one"])})`);
    return lines.join("\n");
  }

  const open = context.warnings.slice(0, 4);
  const done = ["Brand basics", "Voice samples"].slice(0, Math.max(0, 4 - open.length));
  const items = [...done.map((l) => ({ l, done: true })), ...open.map((l) => ({ l, done: false }))];
  lines.push(`root = Answer([score, ${items.length ? "list, " : ""}next, more])`);
  lines.push(
    `score = ScoreBar("Brief", ${context.completeness}, ${q(context.degraded ? "Drafts will read generic until the open items are done." : "Strong enough for on-brand drafts.")})`,
  );
  if (items.length) {
    lines.push(`list = Checklist([${items.map((_, i) => `c${i}`).join(", ")}])`);
    items.forEach((it, i) => lines.push(`c${i} = CheckItem(${q(it.l)}, ${it.done}${it.done ? "" : `, "setup"`})`));
  }
  lines.push(`next = OpenPage("Open Getting started", "setup")`);
  lines.push(`more = FollowUps(${list(["What should I write next?", "Plan my week"])})`);
  return lines.join("\n");
}
