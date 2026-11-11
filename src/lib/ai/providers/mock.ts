/**
 * Deterministic mock providers for local dev and CI (no API keys, no network).
 * Output is built ONLY from the injected brand context block + task input, so it
 * visibly proves context WAS injected (INV-2) and has the real draft shape
 * (hook / body / "→ CTA"). Swap for real providers via env (AI_TEXT_PROVIDER).
 */
import type { ZodType } from "zod";
import { TASKS } from "../tasks";
import { STREAM_SEPARATOR } from "../prompt";
import { mockAgentAnswer } from "@/lib/agent-ui/mock";

/** Kept in step with AGENT_TEMPLATE_KEY in lib/agent-ui/prompt (not imported: that module pulls in the React library). */
const AGENT_TEMPLATE_KEY = "agent_answer";
import type {
  StreamingTextProvider,
  TextStreamEvent,
  StructuredResult,
  ImageGenRequest,
  ImageEditRequest,
  ImageGenResult,
  ImageProvider,
  TextGenRequest,
  TextGenResult,
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
/**
 * The stand-in reads what the real model reads: brand data comes from the
 * context block, never from the task input (INV-2). The tasks' stand-ins look
 * for "Never use:" and "Audience:" lines, so they are supplied here from the
 * context (its guardrails, and the audience line of the block).
 */
function withContextHints(req: TextGenRequest): string {
  const hints: string[] = [];
  const never = req.context.guardrails.dontWords;
  if (never.length && !/^Never use: /m.test(req.taskInput)) hints.push(`Never use: ${never.join(", ")}`);
  const audience = field(req.context.serialized, "Audience");
  if (audience && !/^Audience: /m.test(req.taskInput)) {
    let said = audience;
    try {
      const a = JSON.parse(audience) as Record<string, unknown>;
      said = String(a.description ?? a.who ?? Object.values(a).find((v) => typeof v === "string") ?? "");
    } catch { /* already plain text */ }
    if (said.trim()) hints.push(`Audience: ${said.trim()}`);
  }
  if (req.templateKey === "voice_preview") hints.push(...previewHints(req.context.serialized));
  return hints.length ? `${hints.join("\n")}\n${req.taskInput}` : req.taskInput;
}

/**
 * The live preview's hints, read from the context block the way the real
 * model reads them (INV-2): the casual-formal dial, a punctuation ban, the
 * measured sentence length and a closing question. The task input carries
 * only the paragraph.
 */
export function previewHints(s: string): string[] {
  const out: string[] = [];
  const casual = s.match(/Casual[–-]Formal (\d+)/)?.[1];
  if (casual) out.push(`Casual to formal: ${casual}`);
  if (/No [^.\n]*exclamation marks|free of [^?\n]*exclamation marks/.test(s)) out.push("Exclamation marks: never");
  const avg = s.match(/Sentences average (\d+(?:\.\d+)?) words/)?.[1];
  if (avg) out.push(`Average sentence words: ${Math.round(Number(avg))}`);
  if (/Does it end on a question\?/.test(s)) out.push("Asks questions: often");
  return out;
}

function mockPillars(req: TextGenRequest): string {
  const s = req.context.serialized;
  const niche = field(s, "Niche") || "your field";
  // Strategy answers are in the context block (INV-2), one "key: answer" per line.
  const ans = (k: string) => s.match(new RegExp(`^${k}: (.+)$`, "m"))?.[1]?.trim() ?? "";
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

export const mockTextProvider: StreamingTextProvider = {
  name: "mock",
  /**
   * The stand-in streams the same drafts `generate` would return, a few
   * characters at a time, so the canvas shows a draft being written exactly
   * as it will with a real model. Paced like a fast model (~250 chars/s).
   */
  async *stream(req, model): AsyncIterable<TextStreamEvent> {
    const out = await mockTextProvider.generate(req, model);
    const text = out.variants.join(`\n${STREAM_SEPARATOR}\n`);
    for (let i = 0; i < text.length; ) {
      const n = 3 + ((i * 7) % 6);
      yield { type: "delta", text: text.slice(i, i + n) };
      i += n;
      await new Promise((r) => setTimeout(r, 16));
    }
    yield { type: "done", model, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
  },
  async generate(req: TextGenRequest, model: string): Promise<TextGenResult> {
    if (req.templateKey === AGENT_TEMPLATE_KEY) {
      const text = mockAgentAnswer(req.context, req.taskInput);
      return { variants: [text], model, tokensIn: req.context.serialized.length + req.taskInput.length, tokensOut: text.length };
    }
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
    // A steer changes the draft the way a real rewrite would (another opening,
    // fewer lines for "shorter"), never by writing the instruction into it.
    const turn = [...steer].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % HOOKS.length;
    const variants = Array.from({ length: n }, (_, i) => {
      const hook = angle && i === 0 && !steer && angleHook[angle] ? angleHook[angle] : HOOKS[(i + turn) % HOOKS.length](s0);
      const body = [
        positioning ? `${positioning}` : `I work in ${niche}.`,
        short ? "" : `Three things I've learned about ${s0}:`,
        short ? "" : `1. Say the ${doWords[0] ?? "specific"} thing, not the safe thing.`,
        short ? "" : `2. Show the work — one ${doWords[1] ?? "real"} example beats ten claims.`,
        short ? "" : `3. Keep it ${doWords[2] ?? "plain"}. Your audience is busy.`,
        // A thin brief is said on the page (content board, agent panel), not in the draft.
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

  async structured<T>(req: TextGenRequest, model: string, schema: ZodType<T>): Promise<StructuredResult<T>> {
    const task = TASKS[req.templateKey];
    if (!task) throw new Error(`No stand-in answer for task "${req.templateKey}".`);
    // Validated like a real reply, so a stand-in can never pass a shape the
    // real provider would fail.
    const data = schema.parse(task.mock(withContextHints(req)));
    return { data, model, tokensIn: req.context.serialized.length + req.taskInput.length, tokensOut: JSON.stringify(data).length };
  },
};

/** A stable number from a string: the same brief always draws the same picture. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** The brand palette from the context block ("Palette: #111, #f4f4f4"), or ink and paper. */
function paletteOf(serialized: string): string[] {
  const line = serialized.match(/^Palette: (.+)$/m)?.[1] ?? "";
  const hex = [...line.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)].map((m) => m[0]);
  return hex.length >= 2 ? hex.slice(0, 5) : ["#111111", "#f4f4f4", "#ff3429"];
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The stand-in picture maker: a real image in the brand's colours (gradient
 * and shapes seeded by the brief), so the whole picture flow can be used and
 * tested without a key. A brief that asks for exact text ("Text: ...") gets it
 * drawn in, like "text in the picture" on the real model.
 */
export const mockImageProvider: ImageProvider = {
  name: "mock",
  async generate(req: ImageGenRequest, model: string): Promise<ImageGenResult> {
    const { default: sharp } = await import("sharp");
    const { SIZES } = await import("./openai-image");
    const { width, height } = SIZES[req.shape ?? "square"];
    const pal = paletteOf(req.context.serialized);
    const seed = seedOf(req.prompt);
    const pick = (i: number) => pal[(seed >>> (i * 3)) % pal.length];
    const shapes = Array.from({ length: 5 }, (_, i) => {
      const r = 80 + ((seed >>> (i * 4)) % 260);
      const cx = (seed >>> (i * 5)) % width;
      const cy = (seed >>> (i * 6 + 1)) % height;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${pick(i + 2)}" fill-opacity="0.35"/>`;
    }).join("");
    const text = req.prompt.match(/^Text: "?(.+?)"?$/m)?.[1]?.slice(0, 80);
    const words = text ? text.split(/\s+/) : [];
    const lines: string[] = [];
    for (const w of words) {
      const last = lines.at(-1);
      if (last && (last + " " + w).length <= 22) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    const textSvg = lines
      .map((l, i) => `<text x="${width * 0.08}" y="${height * 0.62 + i * 74}" font-family="Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff">${esc(l)}</text>`)
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pick(0)}"/><stop offset="1" stop-color="${pick(1)}"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>${shapes}${textSvg}</svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return { bytes: new Uint8Array(png), mime: "image/png", model, width, height };
  },
  /** Tints and stripes only where the mask is transparent: visibly "that part changed". */
  async edit(req: ImageEditRequest, model: string): Promise<ImageGenResult> {
    const { default: sharp } = await import("sharp");
    const src = sharp(Buffer.from(req.source)).ensureAlpha();
    const { width, height } = await src.metadata();
    if (!width || !height) throw new Error("The stand-in couldn't read the picture.");
    const raw = await src.raw().toBuffer();
    const mask = await sharp(Buffer.from(req.mask)).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    const tint = paletteOf(req.context.serialized)[seedOf(req.prompt) % 3].replace("#", "");
    const full = tint.length === 3 ? tint.split("").map((c) => c + c).join("") : tint;
    const [tr, tg, tb] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (mask[i + 3] >= 128) continue;
        const stripe = ((x + y) >> 4) % 2 === 0 ? 0.65 : 0.45;
        raw[i] = Math.round(raw[i] * (1 - stripe) + tr * stripe);
        raw[i + 1] = Math.round(raw[i + 1] * (1 - stripe) + tg * stripe);
        raw[i + 2] = Math.round(raw[i + 2] * (1 - stripe) + tb * stripe);
      }
    }
    const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return { bytes: new Uint8Array(png), mime: "image/png", model, width, height };
  },
};
