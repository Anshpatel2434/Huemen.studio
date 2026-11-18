/**
 * Reading a person's reference designs (look_read, vision) and adding one
 * from a link.
 *
 *   - colours are MEASURED from the pixels (a synthetic image), near-duplicates dropped
 *   - the copy a vision model sees is downscaled
 *   - a stored reading is cleaned and capped; a stale one stays out of prompts
 *   - the reading reaches every prompt through visualCoreLines and the one builder (INV-2)
 *   - Groq and Anthropic send the pictures in their own request shapes
 *   - the link fetcher refuses private addresses, non-pictures and oversize files,
 *     and finds a Pinterest pin's og:image
 *   - against the database: the reading is stored and logged, seeds only empty
 *     fields, goes stale when a design is removed, and another workspace can
 *     neither read nor attach to it (INV-1)
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appPool } from "@/db/pool";
import { measureColours, forVision, imageFromPage, isPinterestUrl, VISION_MAX_SIDE } from "@/lib/visual/look-read";
import { cleanCore, cleanLook, lookIsCurrent, lookLines, visualCoreLines, LOOK_CAPS, type LookReading } from "@/lib/visual/core";
import { buildBrandContext } from "@/lib/context/context-builder";
import { assemblePrompt, resolveVisionModel } from "@/lib/ai";
import { lookRead, lookDesigns, TASKS } from "@/lib/ai/tasks";
import { TEMPLATE_CATALOG } from "@/lib/ai/template-defaults";
import { mockTextProvider } from "@/lib/ai/providers/mock";
import { groqTextProvider, type GroqFetch } from "@/lib/ai/providers/groq";
import { anthropicTextProvider, type MessagesParser } from "@/lib/ai/providers/anthropic";
import { AiConfigError } from "@/lib/ai/errors";
import { FETCH_RULES, MAX_IMAGE_BYTES, WebImportError, safeGetImage, safeGetLink } from "@/lib/integrations/web";
import { addReferenceFromLink, lookTaskInput, PINTEREST_BLOCKED, readLook } from "@/lib/data/look";
import { AssetError, deleteAsset, storeAsset } from "@/lib/data/assets";
import { loadVisualIdentity, saveVisualIdentity } from "@/lib/data/foundation";
import { loadBrandContext } from "@/lib/context/context-loader";
import type { Env } from "@/lib/env";

const png = async (width: number, height: number, parts: { colour: [number, number, number]; share: number }[]) => {
  // Vertical bands, each `share` of the width.
  let x = 0;
  const composites = parts.map((p) => {
    const w = Math.round(width * p.share);
    const band = { input: { create: { width: Math.max(1, w), height, channels: 3 as const, background: { r: p.colour[0], g: p.colour[1], b: p.colour[2] } } }, left: x, top: 0 };
    x += w;
    return band;
  });
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(composites).png().toBuffer());
};

const READING: LookReading = {
  at: "2026-11-18T10:00:00.000Z",
  sources: ["11111111-1111-4111-8111-111111111111"],
  designs: [{ assetId: "11111111-1111-4111-8111-111111111111", summary: "A quote post on a pale ground.", colours: ["#1F4D3A", "#F6F1E9"] }],
  mood: "Quiet and assured.",
  typeFeel: "Serif headlines, light weight, sentence case, airy.",
  layout: "One column, wide margins.",
  photoStyle: "No photos or illustration.",
  motifs: "A thin rule above the headline.",
  colourUse: "Pale ground, deep green accent.",
  agrees: ["Calm like the writing."],
  clashes: [],
  direction: "Calm, roomy frames in green and cream, one idea each.",
  avoid: ["stock photos", "neon"],
};

// ---- measuring ----------------------------------------------------------------

describe("colours are measured, not asked for", () => {
  it("finds the dominant colours of a synthetic design, biggest first, near-duplicates dropped", async () => {
    const img = await png(200, 100, [
      { colour: [0x1f, 0x4d, 0x3a], share: 0.6 }, // deep green, most of it
      { colour: [0x21, 0x4f, 0x3c], share: 0.1 }, // a near-duplicate of the green
      { colour: [0xff, 0x34, 0x29], share: 0.3 }, // vermilion
    ]);
    const colours = await measureColours(img);
    expect(colours[0]).toBe("#1F4D3A");
    expect(colours).toContain("#FF3429");
    expect(colours).toHaveLength(2);
  });
  it("keeps at most five and ignores specks", async () => {
    const parts = Array.from({ length: 7 }, (_, i) => ({ colour: [i * 36, 255 - i * 36, (i * 90) % 255] as [number, number, number], share: 1 / 7 }));
    expect((await measureColours(await png(700, 70, parts))).length).toBeLessThanOrEqual(5);
  });
  it("sends the vision model a small JPEG", async () => {
    const big = await png(2000, 1000, [{ colour: [10, 20, 30], share: 1 }]);
    const v = await forVision(big);
    expect(v.mime).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(v.data)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(VISION_MAX_SIDE);
  });
});

// ---- storing and serving the reading ----------------------------------------

describe("the stored reading", () => {
  it("is cleaned and capped: long text cut, lists capped, bad colours and ids dropped", () => {
    const long = "x".repeat(2000);
    const l = cleanLook({
      ...READING,
      mood: long,
      direction: long,
      avoid: Array.from({ length: 12 }, (_, i) => `item ${i} ${long}`),
      agrees: ["a", "b", "c", "d"],
      designs: [{ ...READING.designs[0], summary: long, colours: ["#1f4d3a", "red", "#12", "#AABBCC", "#000000", "#111111", "#222222", "#333333"] }, { assetId: "not-an-id", summary: "x", colours: [] }],
    })!;
    expect(l.mood.length).toBe(LOOK_CAPS.field);
    expect(l.direction.length).toBe(LOOK_CAPS.direction);
    expect(l.avoid).toHaveLength(LOOK_CAPS.items);
    expect(l.avoid[0].length).toBe(LOOK_CAPS.item);
    expect(l.agrees).toHaveLength(3);
    expect(l.designs).toHaveLength(1);
    expect(l.designs[0].summary.length).toBe(LOOK_CAPS.summary);
    expect(l.designs[0].colours).toEqual(["#1F4D3A", "#AABBCC", "#000000", "#111111", "#222222"]);
    expect(cleanLook({ ...READING, sources: [] })).toBeNull();
    expect(cleanLook("nope")).toBeNull();
  });
  it("rides in the Visual Core and says whether it matches the designs on file", () => {
    expect(cleanCore({ layout: "x", look: READING }).look?.mood).toBe(READING.mood);
    expect(cleanCore({ layout: "x", look: { junk: 1 } as never }).look).toBeUndefined();
    expect(lookIsCurrent(READING, READING.sources)).toBe(true);
    expect(lookIsCurrent(READING, [...READING.sources, "22222222-2222-4222-8222-222222222222"])).toBe(false);
    expect(lookIsCurrent({ ...READING, stale: true }, READING.sources)).toBe(false);
  });
  it("reaches the prompt through visualCoreLines and the one builder, and a stale one does not", () => {
    const lines = visualCoreLines({ layout: "Mine", look: READING });
    expect(lines).toContain("Layout: Mine");
    expect(lines.some((l) => l.startsWith("Look, read from their reference designs") && l.includes("mood: Quiet and assured."))).toBe(true);
    expect(lines).toContain("Visual direction (look matched to voice): Calm, roomy frames in green and cream, one idea each.");
    expect(lines).toContain("Avoid in pictures: stock photos; neon");
    const ctx = buildBrandContext({ visualIdentity: { palette: ["#F6F1E9"], coreLines: lines } });
    expect(ctx.serialized).toContain("Visual direction (look matched to voice):");
    expect(lookLines({ ...READING, stale: true })).toEqual([]);
    expect(visualCoreLines({ look: { ...READING, stale: true } }).join("\n")).not.toContain("Look, read from");
  });
});

// ---- the task -------------------------------------------------------------------

describe("the look_read task", () => {
  it("is a registered, admin-editable template", () => {
    expect(TASKS.look_read).toBe(lookRead);
    const entry = TEMPLATE_CATALOG.find((t) => t.key === "look_read")!;
    expect(entry.group).toBe("task");
    expect(entry.defaultBody).toBe(lookRead.template);
    expect(lookRead.template).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
  it("gets the voice from the context block, never from the task input (INV-2)", async () => {
    const context = buildBrandContext({ voicePack: { toneDescriptors: ["warm", "plain"], voiceLine: "Says it straight." } });
    const input = lookTaskInput([{ assetId: "11111111-1111-4111-8111-111111111111", colours: ["#1F4D3A"] }]);
    // The task input carries the designs and their measured colours only.
    expect(input).toBe("Designs: 1 (the picture)\nDesign 1: id 11111111-1111-4111-8111-111111111111; measured colours: #1F4D3A");
    expect(lookDesigns(input)).toEqual([{ assetId: "11111111-1111-4111-8111-111111111111", colours: ["#1F4D3A"] }]);
    const prompt = assemblePrompt(lookRead.template, context, input, { templateKey: lookRead.key, contract: lookRead.contract });
    expect(prompt.system).toContain("<brand_context>");
    expect(prompt.system).toContain("Tone: warm, plain");
    expect(prompt.user).not.toContain("warm");
    // The stand-in reads the tone off the context, as the real model does.
    const out = await mockTextProvider.structured({ templateKey: "look_read", context, taskInput: input, prompt } as never, "mock-vision", lookRead.schema);
    expect(out.data.direction).toContain("warm, plain");
    expect(out.data.designs[0].assetId).toBe("11111111-1111-4111-8111-111111111111");
  });
  it("the data module loads the one context and builds no brand context of its own", () => {
    const src = readFileSync(join(__dirname, "..", "src", "lib", "data", "look.ts"), "utf8");
    expect(src).toContain("await loadBrandContext(scope");
    expect(src).not.toMatch(/Tone: |Voice: |Audience: |Niche: /);
  });
  it("runs on the vision model named in config, never a guess", () => {
    const env = (over: Partial<Env>) => ({ AI_TEXT_PROVIDER: "groq", ...over }) as Env;
    expect(resolveVisionModel(env({ AI_VISION_MODEL: "qwen/qwen3.8-27b" }))).toBe("qwen/qwen3.8-27b");
    expect(() => resolveVisionModel(env({}))).toThrow(AiConfigError);
    expect(resolveVisionModel(env({ AI_TEXT_PROVIDER: "anthropic", AI_TEXT_MODEL_STRONG: "claude-opus-5-5" }))).toBe("claude-opus-5-5");
    expect(resolveVisionModel(env({ AI_TEXT_PROVIDER: "mock" }))).toBe("mock-vision");
  });
});

// ---- providers ---------------------------------------------------------------------

describe("pictures in the request", () => {
  const prompt = { system: "sys", user: "look at these" };
  const images = [{ mime: "image/jpeg" as const, data: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) }];
  const answer = { ...READING, designs: [{ assetId: "a", summary: "s" }] };

  it("Groq: an OpenAI-style content array, the text then each picture as a data URI", async () => {
    const calls: Record<string, unknown>[] = [];
    const f: GroqFetch = async (_url, init) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ model: "qwen/qwen3.8-27b", choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 200 } }), { status: 200 });
    };
    const out = await groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, f).structured({ prompt, images } as never, "qwen/qwen3.8-27b", lookRead.schema);
    expect(out.data.mood).toBe(READING.mood);
    const user = (calls[0].messages as { role: string; content: unknown }[])[1];
    expect(user.role).toBe("user");
    const parts = user.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toContain("look at these");
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from(images[0].data).toString("base64")}` } });
    expect(calls[0].model).toBe("qwen/qwen3.8-27b");
  });

  it("Groq without pictures still sends plain text", async () => {
    const calls: Record<string, unknown>[] = [];
    const f: GroqFetch = async (_url, init) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }] }), { status: 200 });
    };
    await groqTextProvider({ apiKey: "k", timeoutMs: 1000 }, f).structured({ prompt } as never, "m", lookRead.schema);
    expect(typeof (calls[0].messages as { content: unknown }[])[1].content).toBe("string");
  });

  it("Anthropic: base64 image blocks before the text in the user turn", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: { messages: { parse: async (p: Record<string, unknown>) => { calls.push(p); return { model: "claude-opus-5-5", stop_reason: "end_turn", stop_details: null, parsed_output: answer, usage: { input_tokens: 1, output_tokens: 1 } }; } } },
    } as unknown as MessagesParser;
    await anthropicTextProvider({ fallbacks: "off", timeoutMs: 1000 }, client).structured({ prompt, images } as never, "claude-opus-5-5", lookRead.schema);
    const content = (calls[0].messages as { content: unknown }[])[0].content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(images[0].data).toString("base64") } });
    expect(content[1]).toEqual({ type: "text", text: "look at these" });
  });
});

// ---- links ---------------------------------------------------------------------------------

describe("a design from a link", () => {
  const PIN = `<html><head><meta property="og:title" content="A pin"><meta property="og:image" content="https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg"><meta name="twitter:image" content="https://i.pinimg.com/x.jpg"></head><body></body></html>`;
  it("finds the picture a Pinterest pin shares", () => {
    expect(imageFromPage(PIN, "https://www.pinterest.com/pin/123/")).toBe("https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg");
    expect(imageFromPage(`<meta name="twitter:image" content="/img/a.png">`, "https://example.com/post")).toBe("https://example.com/img/a.png");
    expect(imageFromPage(`<meta property="og:image" content="javascript:alert(1)">`, "https://example.com/")).toBeNull();
    expect(imageFromPage("<html></html>", "https://example.com/")).toBeNull();
    expect(isPinterestUrl("https://pin.it/abc")).toBe(true);
    expect(isPinterestUrl("https://uk.pinterest.com/pin/1/")).toBe(true);
    expect(isPinterestUrl("https://notpinterest.com/pin/1/")).toBe(false);
  });
  it("refuses private addresses at the fetcher", async () => {
    for (const u of ["http://127.0.0.1/a.png", "http://169.254.169.254/latest", "http://10.0.0.5/x.jpg", "http://localhost/a.png", "http://[::1]/a.png"]) {
      await expect(safeGetImage(u), u).rejects.toBeInstanceOf(WebImportError);
      await expect(safeGetLink(u), u).rejects.toBeInstanceOf(WebImportError);
    }
  });
  it("lets only pictures and pages through, at most 5 MB", () => {
    expect(FETCH_RULES.image.refuseType("image/png")).toBeNull();
    expect(FETCH_RULES.image.refuseType("image/jpeg; charset=binary")).toBeNull();
    expect(FETCH_RULES.image.refuseType("image/webp")).toBeNull();
    for (const t of ["text/html", "image/svg+xml", "image/gif", "application/pdf", ""]) expect(FETCH_RULES.image.refuseType(t), t).not.toBeNull();
    expect(FETCH_RULES.pageOrImage.refuseType("text/html; charset=utf-8")).toBeNull();
    expect(FETCH_RULES.pageOrImage.refuseType("application/zip")).not.toBeNull();
    expect(FETCH_RULES.image.maxBytes).toBe(5 * 1024 * 1024);
    expect(FETCH_RULES.pageOrImage.maxBytes).toBe(MAX_IMAGE_BYTES);
  });
});

// ---- against the database --------------------------------------------------------------

let ownerPool: Pool | null = null;
const admin = async <T,>(sql: string, args: unknown[] = []) => {
  ownerPool ??= new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  return (await ownerPool.query(sql, args)).rows as T[];
};
let dbReachable = false;
const tenants: string[] = [];
type W = { tenantId: string; userId: string; isPlatformAdmin: boolean };
let A: W;
let B: W;

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const mk = async (name: string, email: string): Promise<W> => {
    const [t] = await admin<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name]);
    const [u] = await admin<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','active') RETURNING id", [t.id, email]);
    tenants.push(t.id);
    return { tenantId: t.id, userId: u.id, isPlatformAdmin: false };
  };
  A = await mk("Look A (test)", `look-a-${Date.now()}@test.local`);
  B = await mk("Look B (test)", `look-b-${Date.now()}@test.local`);
}, 60_000);

afterAll(async () => {
  if (!dbReachable) return;
  await admin("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenants]);
  await ownerPool?.end();
  await appPool().end();
});

const coreOf = async (tenantId: string) =>
  (await admin<{ core: Record<string, unknown> }>("SELECT core FROM visual_identities WHERE tenant_id = $1", [tenantId]))[0]?.core ?? {};

describe("reading the designs on file (database)", () => {
  let first: string;
  let second: string;

  it("reads every design in one logged call, stores it, and seeds only the empty fields", async () => {
    if (!dbReachable) return;
    await saveVisualIdentity(A, { palette: ["#FFFFFF", "#111111"], fonts: [], imageStyleNotes: "", core: { layout: "My own layout" } });
    first = (await storeAsset(A, await png(120, 120, [{ colour: [0x1f, 0x4d, 0x3a], share: 0.7 }, { colour: [0xf6, 0xf1, 0xe9], share: 0.3 }]), "reference_image")).id;
    second = (await storeAsset(A, await png(120, 120, [{ colour: [0xff, 0x34, 0x29], share: 1 }]), "reference_image")).id;
    const before = (await admin<{ n: number }>("SELECT count(*)::int AS n FROM generation_logs WHERE tenant_id = $1", [A.tenantId]))[0].n;

    const look = (await readLook(A))!;
    expect(look.sources.sort()).toEqual([first, second].sort());
    expect(look.designs.find((d) => d.assetId === first)!.colours[0]).toBe("#1F4D3A");
    expect(look.designs.find((d) => d.assetId === second)!.colours).toEqual(["#FF3429"]);

    const logs = await admin<{ model: string; status: string }>("SELECT model, status FROM generation_logs WHERE tenant_id = $1 ORDER BY created_at DESC", [A.tenantId]);
    expect(logs.length).toBe(before + 1);
    // The stand-in answers; the logged model name is whatever the config names (a local .env may set AI_VISION_MODEL).
    expect(logs[0]).toEqual({ model: process.env.AI_VISION_MODEL || "mock-vision", status: "ok" });

    const core = await coreOf(A.tenantId);
    expect((core.look as LookReading).mood).toBe(look.mood);
    expect(core.layout).toBe("My own layout"); // never overwritten
    expect(core.motifs).toBe(look.motifs); // empty, so seeded
    expect(core.photoStyle).toBe(look.photoStyle);

    // Every generation now carries it, through the one builder.
    const ctx = await loadBrandContext(A);
    expect(ctx.serialized).toContain("Look, read from their reference designs");
    expect(ctx.serialized).toContain("Visual direction (look matched to voice):");
  });

  it("a save from the style guide keeps the reading", async () => {
    if (!dbReachable) return;
    const v = await loadVisualIdentity(A);
    await saveVisualIdentity(A, { ...v, core: { roles: {}, layout: "Changed", references: [] } });
    expect(((await coreOf(A.tenantId)).look as LookReading).sources).toHaveLength(2);
  });

  it("removing a design marks the reading stale and takes it out of prompts until it is read again", async () => {
    if (!dbReachable) return;
    expect(await deleteAsset(A, second)).toBe(true);
    expect(((await coreOf(A.tenantId)).look as LookReading).stale).toBe(true);
    expect((await loadBrandContext(A)).serialized).not.toContain("Look, read from their reference designs");
    const again = (await readLook(A))!;
    expect(again.stale).toBeUndefined();
    expect(again.sources).toEqual([first]);
    expect((await loadBrandContext(A)).serialized).toContain("Look, read from their reference designs");
  });

  it("another workspace reads only its own designs and never touches A's reading (INV-1)", async () => {
    if (!dbReachable) return;
    const aBefore = JSON.stringify(await coreOf(A.tenantId));
    expect(await readLook(B)).toBeNull();
    // B removing A's design finds nothing under RLS, so A's reading stays current.
    expect(await deleteAsset(B, first)).toBe(false);
    expect(JSON.stringify(await coreOf(A.tenantId))).toBe(aBefore);
  });

  it("adds a Pinterest pin's picture like an upload, under the workspace's own prefix, and refuses what it should", async () => {
    if (!dbReachable) return;
    const picture = await png(300, 200, [{ colour: [0x29, 0x33, 0x5c], share: 1 }]);
    const seen: string[] = [];
    const fake = {
      link: async (u: string) => { seen.push(u); return { url: "https://www.pinterest.com/pin/123/", contentType: "text/html; charset=utf-8", body: new TextEncoder().encode(`<meta property="og:image" content="https://i.pinimg.com/736x/aa.jpg">`) }; },
      image: async (u: string) => { seen.push(u); return { url: u, contentType: "image/png", body: picture }; },
    };
    const { id } = await addReferenceFromLink(B, "pinterest.com/pin/123/", fake);
    expect(seen).toEqual(["https://pinterest.com/pin/123/", "https://i.pinimg.com/736x/aa.jpg"]);
    const [row] = await admin<{ tenant_id: string; kind: string; storage_key: string; mime: string }>("SELECT tenant_id, kind, storage_key, mime FROM assets WHERE id = $1", [id]);
    expect(row).toMatchObject({ tenant_id: B.tenantId, kind: "reference_image", mime: "image/png" });
    expect(row.storage_key.startsWith(`tenants/${B.tenantId}/`)).toBe(true);

    // A pin whose page shares no picture: the plain Pinterest answer.
    const blocked = { ...fake, link: async () => ({ url: "https://pin.it/x", contentType: "text/html", body: new TextEncoder().encode("<html>log in</html>") }) };
    await expect(addReferenceFromLink(B, "https://pin.it/x", blocked)).rejects.toThrow(PINTEREST_BLOCKED);
    // A Pinterest fetch that fails outright gets the same answer.
    const refused = { ...fake, link: async () => { throw new WebImportError("That site answered with an error (403)."); } };
    await expect(addReferenceFromLink(B, "https://www.pinterest.com/pin/9/", refused)).rejects.toThrow(PINTEREST_BLOCKED);
    // Not a picture, whatever the site says it is.
    const notImage = { ...fake, link: async () => ({ url: "https://x.example/a.png", contentType: "image/png", body: new TextEncoder().encode("<html>not a picture</html>") }) };
    await expect(addReferenceFromLink(B, "https://x.example/a.png", notImage)).rejects.toBeInstanceOf(AssetError);
    // Over 5 MB: refused like an upload.
    const huge = new Uint8Array(6 * 1024 * 1024);
    huge.set(picture.slice(0, 64));
    const big = { ...fake, link: async () => ({ url: "https://x.example/b.png", contentType: "image/png", body: huge }) };
    await expect(addReferenceFromLink(B, "https://x.example/b.png", big)).rejects.toThrow(/over 5 MB/);
    // A private address never reaches a fetch.
    await expect(addReferenceFromLink(B, "http://127.0.0.1/a.png")).rejects.toBeInstanceOf(AssetError);
  });

  it("holds at most three designs", async () => {
    if (!dbReachable) return;
    const picture = await png(64, 64, [{ colour: [1, 2, 3], share: 1 }]);
    const fake = { link: async () => ({ url: "https://x.example/c.png", contentType: "image/png", body: picture }), image: async () => ({ url: "", contentType: "image/png", body: picture }) };
    await addReferenceFromLink(B, "https://x.example/c.png", fake);
    await addReferenceFromLink(B, "https://x.example/d.png", fake);
    await expect(addReferenceFromLink(B, "https://x.example/e.png", fake)).rejects.toThrow(/Remove one to add another/);
  });
});

// 2026-11-18 live run: Groq counts every image at a fixed ~1,800 tokens, so
// several designs are read as ONE numbered contact sheet.
import { contactSheet as sheetOf } from "@/lib/visual/look-read";
import sharpLib from "sharp";
describe("contact sheet", () => {
  it("puts the designs side by side in one JPEG, numbered left to right", async () => {
    const red = await sharpLib({ create: { width: 300, height: 400, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const blue = await sharpLib({ create: { width: 600, height: 300, channels: 3, background: "#0000ff" } }).png().toBuffer();
    const out = await sheetOf([new Uint8Array(red), new Uint8Array(blue)]);
    expect(out.mime).toBe("image/jpeg");
    const meta = await sharpLib(Buffer.from(out.data)).metadata();
    expect(meta.width).toBe(2 * 512 + 3 * 24);
    expect(meta.height).toBe(640 + 2 * 24);
    // The middle of each cell is its design's colour (the number tag sits in the corner).
    const { data, info } = await sharpLib(Buffer.from(out.data)).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    const [r1, , b1] = px(24 + 256, 24 + 320);
    const [r2, , b2] = px(24 + 512 + 24 + 256, 24 + 320);
    expect(r1).toBeGreaterThan(200); expect(b1).toBeLessThan(60);
    expect(b2).toBeGreaterThan(200); expect(r2).toBeLessThan(60);
  });
});

describe("adding a design (database)", () => {
  it("marks the reading of the old set out of date, so it leaves every prompt", async () => {
    if (!dbReachable) return;
    await readLook(A);
    expect(((await coreOf(A.tenantId)).look as LookReading).stale).toBeFalsy();
    await storeAsset(A, await png(80, 80, [{ colour: [0x22, 0x88, 0x44], share: 1 }]), "reference_image");
    const look = (await coreOf(A.tenantId)).look as LookReading;
    expect(look.stale).toBe(true);
    // B is untouched by A's upload.
    expect(((await coreOf(B.tenantId)).look as LookReading | undefined)?.stale).toBeFalsy();
  });
});
