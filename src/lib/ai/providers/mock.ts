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
  CutoutProvider,
  CutoutResult,
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
  // The look reading matches the designs to the voice: the stand-in reads the
  // tone off the context block, as the real model does.
  if (req.templateKey === "look_read") {
    const tone = field(req.context.serialized, "Tone");
    if (tone) hints.push(`Tone: ${tone}`);
  }
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
  /**
   * Changes only where the mask is transparent, in a way that shows what was
   * asked (ImageEditRequest `intent`):
   *   area    tints and stripes: visibly "that part changed". Drawn marks are
   *           never copied in, so none of their colour is in the answer.
   *   erase   the brushed area becomes the average colour of what is around it.
   *   extend  the matte is filled with the picture mirrored outwards from its
   *           own edges, so no matte colour is left.
   */
  async edit(req: ImageEditRequest, model: string): Promise<ImageGenResult> {
    const { default: sharp } = await import("sharp");
    const src = sharp(Buffer.from(req.source)).ensureAlpha();
    const { width, height } = await src.metadata();
    if (!width || !height) throw new Error("The stand-in couldn't read the picture.");
    const raw = await src.raw().toBuffer();
    const mask = await sharp(Buffer.from(req.mask)).resize(width, height, { fit: "fill", kernel: "nearest" }).ensureAlpha().raw().toBuffer();
    const open = (i: number) => mask[i * 4 + 3] < 128;
    const intent = req.intent ?? "area";
    if (intent === "erase" || intent === "extend") {
      // The box around the changing pixels (erase) or around the kept ones (extend).
      let x0 = width, y0 = height, x1 = -1, y1 = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (open(y * width + x) !== (intent === "erase")) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      // The average colour of the kept pixels: around the brushed area (erase), or all of them.
      const RING = 6;
      const sum = [0, 0, 0];
      let n = 0;
      const [ax0, ay0, ax1, ay1] = intent === "erase" && x1 >= 0
        ? [Math.max(0, x0 - RING), Math.max(0, y0 - RING), Math.min(width - 1, x1 + RING), Math.min(height - 1, y1 + RING)]
        : [0, 0, width - 1, height - 1];
      for (let y = ay0; y <= ay1; y++) {
        for (let x = ax0; x <= ax1; x++) {
          const i = y * width + x;
          if (open(i)) continue;
          sum[0] += raw[i * 4];
          sum[1] += raw[i * 4 + 1];
          sum[2] += raw[i * 4 + 2];
          n++;
        }
      }
      const avg = n ? sum.map((v) => Math.round(v / n)) : [128, 128, 128];
      const orig = Buffer.from(raw);
      /** `v` folded back into [a, b], as a mirror at each end would show it. */
      const mirror = (v: number, a: number, b: number) => {
        const len = b - a + 1;
        if (v >= a && v <= b) return v;
        if (len <= 1) return a;
        const k = (v < a ? a - v - 1 : v - b - 1) % (2 * len);
        const off = k < len ? k : 2 * len - 1 - k;
        return v < a ? a + off : b - off;
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (!open(i)) continue;
          let from = -1;
          if (intent === "extend" && x1 >= 0) {
            const j = mirror(y, y0, y1) * width + mirror(x, x0, x1);
            if (!open(j)) from = j;
          }
          raw[i * 4] = from >= 0 ? orig[from * 4] : avg[0];
          raw[i * 4 + 1] = from >= 0 ? orig[from * 4 + 1] : avg[1];
          raw[i * 4 + 2] = from >= 0 ? orig[from * 4 + 2] : avg[2];
          raw[i * 4 + 3] = 255;
        }
      }
      const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
      return { bytes: new Uint8Array(png), mime: "image/png", model, width, height };
    }
    const tint = paletteOf(req.context.serialized)[seedOf(req.prompt) % 3].replace("#", "");
    const full = tint.length === 3 ? tint.split("").map((c) => c + c).join("") : tint;
    const [tr, tg, tb] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    // Like a model told to keep the close-up's outer edge as it is, the stand-in
    // changes the middle of the marked area and leaves a rim of it alone, so the
    // change never runs into the area's edge (lib/visual/region cutAtEdge).
    let mx0 = width, my0 = height, mx1 = -1, my1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[(y * width + x) * 4 + 3] >= 128) continue;
        if (x < mx0) mx0 = x;
        if (x > mx1) mx1 = x;
        if (y < my0) my0 = y;
        if (y > my1) my1 = y;
      }
    }
    const rimX = Math.round((mx1 - mx0 + 1) * 0.2), rimY = Math.round((my1 - my0 + 1) * 0.2);
    const whole = mx0 === 0 && my0 === 0 && mx1 === width - 1 && my1 === height - 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (mask[i + 3] >= 128) continue;
        if (!whole && (x < mx0 + rimX || x > mx1 - rimX || y < my0 + rimY || y > my1 - rimY)) continue;
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

/** How close to the border's colour a pixel must be (per channel, 0..255) for the stand-in to call it background. */
const MOCK_CUTOUT_NEAR = 40;

/**
 * The stand-in for background removal: whatever is close to the colour of the
 * picture's outer edge is background and goes transparent; the rest is the
 * subject. The same picture always gives the same cut-out. A picture of one
 * flat colour has no subject at all, which is what the "no clear subject"
 * guard is tested with.
 */
export const mockCutoutProvider: CutoutProvider = {
  name: "mock",
  async cutout(source: Uint8Array): Promise<CutoutResult> {
    const { default: sharp } = await import("sharp");
    const { data, info } = await sharp(Buffer.from(source)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
        const i = (y * width + x) * 3;
        sum[0] += data[i];
        sum[1] += data[i + 1];
        sum[2] += data[i + 2];
        n++;
      }
    }
    const edge = sum.map((v) => v / Math.max(1, n));
    const out = Buffer.alloc(width * height * 4);
    let kept = 0;
    for (let p = 0; p < width * height; p++) {
      const i = p * 3;
      const far = Math.max(Math.abs(data[i] - edge[0]), Math.abs(data[i + 1] - edge[1]), Math.abs(data[i + 2] - edge[2])) > MOCK_CUTOUT_NEAR;
      out[p * 4] = data[i];
      out[p * 4 + 1] = data[i + 1];
      out[p * 4 + 2] = data[i + 2];
      out[p * 4 + 3] = far ? 255 : 0;
      if (far) kept++;
    }
    const png = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return { bytes: new Uint8Array(png), model: "cutout:mock", coverage: kept / (width * height) };
  },
};
