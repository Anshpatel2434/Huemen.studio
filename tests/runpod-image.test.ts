/**
 * The Runpod image provider against a fake HTTP layer: request shapes for a
 * draw and an area redraw, the queued-then-polled path, the result downloaded
 * and returned as PNG at the right size, and failures mapped to provider errors.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { closeUp, closeUpPrompt, markedBox, resultUrl, runpodImageProvider, type FetchLike } from "@/lib/ai/providers/runpod-image";
import { regionMask } from "@/lib/visual/region";
import { ProviderError } from "@/lib/ai/errors";

const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } }).jpeg().toBuffer();
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#113355" } }).png().toBuffer();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fake(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  const f: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.Authorization ?? null });
    return handler(url, init);
  };
  return { f, calls };
}

const req = { context: {} as never, prompt: "A quiet desk by a window, morning light", negativePrompt: "stock photo look" };

describe("runpod image provider", () => {
  it("draws: asks the endpoint for the frame's size and returns the picture as PNG", async () => {
    const picture = await jpeg(1024, 1280);
    const { f, calls } = fake((url) =>
      url.endsWith("/runsync") ? json({ id: "j1", status: "COMPLETED", output: { result: "https://image.runpod.ai/x/out.jpg", cost: 0.02 } }) : new Response(new Uint8Array(picture)),
    );
    const p = runpodImageProvider({ apiKey: "rk", timeoutMs: 5000, editModel: "qwen-image-edit" }, f);
    const out = await p.generate({ ...req, shape: "portrait" }, "qwen-image-t2i");
    expect(calls[0].url).toBe("https://api.runpod.ai/v2/qwen-image-t2i/runsync");
    expect(calls[0].auth).toBe("Bearer rk");
    expect(calls[0].body).toEqual({ input: { prompt: req.prompt, negative_prompt: "stock photo look", size: "1024*1280", seed: -1, enable_safety_checker: true } });
    expect(calls[1].url).toBe("https://image.runpod.ai/x/out.jpg");
    expect(calls[1].auth).toBeNull(); // the key never goes to the image host
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect([out.mime, meta.format, out.width, out.height]).toEqual(["image/png", "png", 1024, 1280]);
  });

  it("uses width and height for FLUX endpoints", async () => {
    const picture = await png(1024, 1024);
    const { f, calls } = fake((url) => (url.endsWith("/runsync") ? json({ status: "COMPLETED", output: { image_url: "https://image.runpod.ai/y.png" } }) : new Response(new Uint8Array(picture))));
    await runpodImageProvider({ apiKey: "rk", timeoutMs: 5000, editModel: "e" }, f).generate(req, "black-forest-labs-flux-1-dev");
    expect(calls[0].body).toEqual({ input: { prompt: req.prompt, width: 1024, height: 1024, seed: -1 } });
  });

  it("waits on a queued job by its id", async () => {
    const picture = await png(1024, 1024);
    let polls = 0;
    const { f, calls } = fake((url) => {
      if (url.endsWith("/runsync")) return json({ id: "job-9", status: "IN_QUEUE" });
      if (url.endsWith("/status/job-9")) return json(++polls < 2 ? { id: "job-9", status: "IN_PROGRESS" } : { id: "job-9", status: "COMPLETED", output: "https://image.runpod.ai/z.png" });
      return new Response(new Uint8Array(picture));
    });
    const out = await runpodImageProvider({ apiKey: "rk", timeoutMs: 20000, editModel: "e" }, f).generate(req, "qwen-image-t2i");
    expect(out.width).toBe(1024);
    expect(calls.filter((c) => c.url.includes("/status/")).length).toBe(2);
  }, 15000);

  it("redraws: sends only a close-up of the marked area, and pastes the answer back in place", async () => {
    const source = new Uint8Array(await png(1024, 1536)); // dark blue everywhere
    const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };
    const mask = await regionMask(box, 1024, 1536, 0);
    const edited = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#ff0000" } }).jpeg().toBuffer(); // the model answers in its own size, all red
    const { f, calls } = fake((url) => (url.endsWith("/runsync") ? json({ status: "COMPLETED", output: { result: "https://image.runpod.ai/e.jpg" } }) : new Response(new Uint8Array(edited))));
    const out = await runpodImageProvider({ apiKey: "rk", timeoutMs: 5000, editModel: "qwen-image-edit" }, f).edit(
      { context: {} as never, prompt: "Change only the marked area: put a coffee cup here\nKeep everything else exactly as it is.\nThe picture: a long scene description\nNo words, letters or logos.", source, mask, shape: "portrait" },
      "qwen-image-t2i",
    );
    expect(calls[0].url).toBe("https://api.runpod.ai/v2/qwen-image-edit/runsync");
    const input = (calls[0].body as { input: Record<string, string> }).input;
    // The model gets what was asked and the rule about words, not the whole scene's description.
    expect(input.prompt).toContain("put a coffee cup here");
    expect(input.prompt).toContain("No words, letters or logos.");
    expect(input.prompt).not.toContain("a long scene description");
    expect(input.prompt).toContain("close-up of one part of a larger picture");
    // What it was sent is the close-up, enlarged, not the whole picture.
    const sent = await sharp(Buffer.from(input.image.split(",")[1], "base64")).metadata();
    expect(Math.max(sent.width!, sent.height!)).toBeGreaterThanOrEqual(1000);
    expect(sent.width! / sent.height!).toBeCloseTo((0.3 * 1024) / (0.2 * 1536), 1);
    // The answer comes back as the full picture, changed only in and around the mark.
    expect([out.width, out.height]).toEqual([1024, 1536]);
    const px = async (x: number, y: number) => {
      const { data } = await sharp(Buffer.from(out.bytes)).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      return data[0];
    };
    expect(await px(Math.round(0.25 * 1024), Math.round(0.2 * 1536))).toBeGreaterThan(200); // inside the mark: red
    expect(await px(900, 1400)).toBeLessThan(60); // far away: untouched
    expect(await px(Math.round(0.6 * 1024), Math.round(0.2 * 1536))).toBeLessThan(60); // beside it: untouched
  });

  it("the close-up says to replace the marked content entirely, and takes the rule about words from the rule's own line only", () => {
    const text = closeUpPrompt(
      "Change only the marked area: a calm ceramic mug\nKeep everything else exactly as it is: the same subject.\nThe picture: a desk with a calendar showing 12 and No words, letters, numbers, hex codes or logos anywhere in the picture.\nNo words, letters or logos.",
      true,
    );
    expect(text).toContain("Replace everything in this image with: a calm ceramic mug.");
    expect(text).toMatch(/Remove what is there now completely, including any text, letters, numbers, calendar dates/);
    // The rule is the caller's own line, not the picture's description that happens to contain the same words.
    expect(text).toContain("No words, letters or logos.");
    expect(text).not.toContain("The picture: a desk");
    // Without a mark the whole picture is the area: plain instruction, no close-up wording.
    expect(closeUpPrompt("Change only the marked area: warmer light", false)).not.toMatch(/close-up/);
  });

  it("maps refusals and HTTP failures to provider errors", async () => {
    const failed = fake(() => json({ status: "FAILED", error: "Invalid parameter: size" }));
    await expect(runpodImageProvider({ apiKey: "rk", timeoutMs: 5000, editModel: "e" }, failed.f).generate(req, "m")).rejects.toMatchObject({ kind: "bad_request" });
    for (const [status, kind] of [[401, "auth"], [429, "rate_limit"], [503, "server"]] as const) {
      const { f } = fake(() => new Response("x", { status }));
      const err = await runpodImageProvider({ apiKey: "rk", timeoutMs: 5000, editModel: "e" }, f).generate(req, "m").catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe(kind);
    }
    const noImage = fake(() => json({ status: "COMPLETED", output: { cost: 0.02 } }));
    await expect(runpodImageProvider({ apiKey: "rk", timeoutMs: 5000, editModel: "e" }, noImage.f).generate(req, "m")).rejects.toMatchObject({ kind: "unparseable" });
  });

  it("finds the picture's address in the shapes endpoints use, and words the area", async () => {
    expect(resultUrl({ result: "https://a/b.png" })).toBe("https://a/b.png");
    expect(resultUrl({ images: [{ url: "https://a/c.png" }] })).toBe("https://a/c.png");
    expect(resultUrl({ result: "not a url" })).toBeNull();
    const centre = await markedBox(await regionMask({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 800, 800, 0));
    expect(centre!.left).toBeGreaterThanOrEqual(318);
    expect(centre!.left).toBeLessThanOrEqual(322);
    expect(Math.abs(centre!.width - 160)).toBeLessThanOrEqual(4);
    expect(await markedBox(new Uint8Array([1, 2, 3]))).toBeNull();
    // The close-up takes a little of the surroundings and never leaves the picture.
    expect(closeUp({ left: 0, top: 0, width: 100, height: 100 }, 800, 800)).toEqual({ left: 0, top: 0, width: 118, height: 118 });
    expect(closeUp({ left: 700, top: 700, width: 100, height: 100 }, 800, 800)).toEqual({ left: 682, top: 682, width: 118, height: 118 });
  });
});
