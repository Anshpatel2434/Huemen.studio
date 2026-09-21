/**
 * Deterministic mock providers for local dev and CI (no API keys, no network).
 * Output is built ONLY from the injected brand context block + task input, so it
 * visibly proves context WAS injected (INV-2) and has the real draft shape
 * (hook / body / "→ CTA"). Swap for real providers via env (AI_TEXT_PROVIDER).
 */
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageProvider,
  TextGenRequest,
  TextGenResult,
  TextProvider,
} from "../types";

function field(serialized: string, label: string): string {
  const m = serialized.match(new RegExp(`^${label}: (.+)$`, "m"));
  return m ? m[1].trim() : "";
}

function parseTask(taskInput: string): { topic: string; steer: string } {
  const topic = taskInput.match(/^Topic: (.+)$/m)?.[1]?.trim() ?? taskInput.trim();
  const steer = taskInput.match(/^Steer: (.+)$/m)?.[1]?.trim() ?? "";
  return { topic, steer };
}

const HOOKS = [
  (t: string) => `Most advice about ${t} is wrong. Here's what actually works.`,
  (t: string) => `I used to get ${t} completely wrong.`,
  (t: string) => `${t[0]?.toUpperCase() ?? ""}${t.slice(1)}: the part nobody talks about.`,
];

/** "Name :: description" lines built from the strategy answers + brief. */
function mockPillars(req: TextGenRequest): string {
  const s = req.context.serialized;
  const niche = field(s, "Niche") || "your field";
  const ans = (k: string) => req.taskInput.match(new RegExp(`^${k}: (.+)$`, "m"))?.[1]?.trim() ?? "";
  const clip = (t: string) => (t.length > 70 ? `${t.slice(0, 67)}…` : t);
  const out: string[] = [];
  const focus = req.taskInput.match(/^Focus: (.+)$/m)?.[1]?.trim();
  if (focus) out.push(`${focus.charAt(0).toUpperCase()}${focus.slice(1, 40)} :: The angle you asked to focus on`);
  if (ans("known_for")) out.push(`Signature point of view :: ${clip(ans("known_for"))}`);
  if (ans("contrarian")) out.push(`Contrarian takes :: Where you disagree with ${niche} orthodoxy: ${clip(ans("contrarian"))}`);
  if (ans("questions")) out.push(`Client questions, answered :: ${clip(ans("questions"))}`);
  if (ans("proof")) out.push(`Proof & case stories :: ${clip(ans("proof"))}`);
  if (ans("behind")) out.push(`Behind the work :: ${clip(ans("behind"))}`);
  if (out.length < 3) out.push(`Lessons from ${niche} :: What the work has taught you, one lesson at a time`, "How I work :: Your process, made visible", "Origin story :: Where this started and why it matters");
  const count = Number(req.taskInput.match(/^Count: (\d+)$/m)?.[1] ?? 5);
  return out.slice(0, Math.max(1, Math.min(5, count))).join("\n");
}

export const mockTextProvider: TextProvider = {
  name: "mock",
  async generate(req: TextGenRequest, model: string): Promise<TextGenResult> {
    if (req.templateKey === "pillar_set") {
      const text = mockPillars(req);
      return { variants: [text], model, tokensIn: req.context.serialized.length + req.taskInput.length, tokensOut: text.length };
    }
    const s = req.context.serialized;
    const niche = field(s, "Niche") || "your niche";
    const positioning = field(s, "Positioning");
    const doWords = req.context.guardrails.doWords.slice(0, 3);
    const { topic: rawTopic, steer } = parseTask(req.taskInput);
    const topic = rawTopic || niche;
    const short = /shorter|punchier/i.test(steer);

    // Pillar-driven topics arrive as "Pillar — angle".
    const [subject, angle] = topic.includes(" — ") ? topic.split(" — ") : [topic, ""];
    const s0 = subject.toLowerCase();
    const angleHook: Record<string, string> = {
      "the mistake most people make": `The mistake most people make with ${s0}.`,
      "a story from the work": `A story from the work about ${s0}.`,
      "a simple framework": `A simple framework for ${s0}.`,
      "what I'd do differently": `What I'd do differently about ${s0}.`,
    };
    const n = req.variants ?? 2;
    const variants = Array.from({ length: n }, (_, i) => {
      const hook = angle && i === 0 && angleHook[angle] ? angleHook[angle] : HOOKS[i % HOOKS.length](s0);
      const body = [
        positioning ? `${positioning}` : `I work in ${niche}.`,
        short ? "" : `Three things I've learned about ${s0}:`,
        short ? "" : `1. Say the ${doWords[0] ?? "specific"} thing, not the safe thing.`,
        short ? "" : `2. Show the work — one ${doWords[1] ?? "real"} example beats ten claims.`,
        short ? "" : `3. Keep it ${doWords[2] ?? "plain"}. Your audience is busy.`,
        steer ? `(${steer.toLowerCase()} pass)` : "",
        req.context.degraded ? "[Draft is generic: the brand foundation is thin.]" : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      return `${hook}\n\n${body}\n\n→ What's your take? Comment below.`;
    });

    return {
      variants,
      model,
      tokensIn: req.context.serialized.length + req.taskInput.length,
      tokensOut: variants.join("").length,
    };
  },
};

export const mockImageProvider: ImageProvider = {
  name: "mock",
  async generate(_req: ImageGenRequest, model: string): Promise<ImageGenResult> {
    // 1x1 transparent PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    return { bytes: new Uint8Array(png), mime: "image/png", model, width: 1, height: 1 };
  },
};
