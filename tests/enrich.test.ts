/**
 * Onboarding that asks less and learns more: pre-fill, "this or that", the
 * live preview, stories/proof/influences/languages, links, captions, YouTube,
 * logo palette. Pure first, then the database.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { extractAnswers, dialPairs, voicePreview, previewSource, TASKS } from "@/lib/ai/tasks";
import { buildBrandContext } from "@/lib/context/context-builder";
import { prefill } from "@/lib/voice/lifecycle";
import { DIAL_KEYS, emptyIndex, type VoicePack } from "@/lib/voice/types";
import { extractArticle, findFeedLink, htmlToText, looksLikeFeed, parseCaptions, parseFeed } from "@/lib/integrations/text";
import { checkUrl, feedFor, importFromUrl, isPrivateAddress, WebImportError, type Getter } from "@/lib/integrations/web";
import { importYouTubeCaptions } from "@/lib/integrations/google";
import { paletteFromPixels } from "@/lib/visual/palette";
import type { FetchLike } from "@/lib/integrations/oauth";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import type { WorkspaceScope } from "@/lib/data/projects";

function pack(over: Partial<VoicePack> = {}): VoicePack {
  return {
    id: "p1", userId: "u1", slug: "default", displayName: "Demo", status: "provisional", version: 1,
    voiceLine: "", hardRules: [], identity: {}, guardrails: [], mechanics: {}, contexts: {}, redPen: {},
    index: emptyIndex(), corpusStats: { pieces: 0, words: 0, sentences: 0, channels: [] }, scannedAt: null,
    onboarding: {}, workMode: "ghostwrite", topicSuggestions: [], topicsGeneratedAt: null,
    ...over,
  };
}

describe("the new tasks are registered and their stand-ins behave", () => {
  it("registers all three", () => {
    for (const t of [extractAnswers, dialPairs, voicePreview]) expect(TASKS[t.key]).toBe(t);
  });

  it("pre-fills only what the material supports", () => {
    const none = extractAnswers.schema.parse(extractAnswers.mock("Brief:\n\nWriting:\n"));
    expect(none.answers).toEqual([]);
    const r = extractAnswers.schema.parse(extractAnswers.mock(
      "Brief:\nAudience: First-time engineering managers\n\nWriting:\n[1] (linkedin) What would you stop doing? Here's mine.\n[2] (linkedin) Delegation is a skill.",
    ));
    expect(r.answers.find((a) => a.id === "A2")?.value).toBe("First-time engineering managers");
    expect(r.answers.find((a) => a.id === "E1")?.value.split(", ").length).toBeGreaterThan(0);
    expect(r.answers.every((a) => a.evidence.length > 0)).toBe(true);
  });

  it("makes one pair per dial asked for", () => {
    const input = DIAL_KEYS.map((d) => `Dial: ${d} (x to y)`).join("\n");
    const { pairs } = dialPairs.schema.parse(dialPairs.mock(input));
    expect(pairs.map((p) => p.dial)).toEqual([...DIAL_KEYS]);
    expect(pairs.every((p) => p.left !== p.right)).toBe(true);
  });

  it("moves the preview as the voice changes", () => {
    const base = `Paragraph:\n${previewSource("leadership")}\n`;
    const plain = voicePreview.mock(base).text;
    expect(plain).toContain("leadership");
    const casual = voicePreview.mock(`${base}\nCasual to formal: 2\nExclamation marks: never`).text;
    expect(casual).toContain("It's not");
    expect(casual).not.toContain("!");
    const formal = voicePreview.mock(`${base}\nCasual to formal: 9`).text;
    expect(formal).toContain("It is not");
    expect(voicePreview.mock(`${base}\nNever use: harder`).text).not.toMatch(/harder/);
    // The hint lines after the paragraph are never part of the preview.
    const hinted = voicePreview.mock(`${base}\nNever use: synergy\nAverage sentence words: 8\nCasual to formal: 9`).text;
    expect(hinted).not.toMatch(/Never use|Average sentence|Casual to formal/);
  });
});

describe("pre-fill order", () => {
  it("prefers what they already said, then their writing, then the brief", () => {
    expect(prefill("A2", "Mine", { audience: "Brief" }, { value: "Writing" })?.from).toBe("what we already have");
    expect(prefill("A2", "", { audience: "Brief" }, { value: "Writing", evidence: "quote" })).toEqual({ value: "Writing", from: "your writing", evidence: "quote" });
    expect(prefill("A2", "", { audience: "Brief" }, null)?.from).toBe("your brief");
    expect(prefill("E1", [], {}, { value: [] })).toBeNull();
  });
});

describe("context v3 carries what a draft can't invent", () => {
  it("adds stories, facts, influences, language and picks to the VOICE section", () => {
    const ctx = buildBrandContext({
      voicePack: {
        stories: [{ title: "The client who fired me", body: "In 2019 a client let me go.", lesson: "Listen first" }],
        proofs: [{ claim: "140 managers coached", source: "my records" }],
        influences: { admire: ["Morgan Housel"], avoid: ["hustle bros"] },
        languages: { primary: "English", also: ["Hinglish"], when: "Hinglish on Instagram" },
        preferences: [{ chosen: "Get out of the car.", over: "Step back further." }],
      },
    });
    expect(ctx.version).toBe(3);
    expect(ctx.serialized).toContain("The client who fired me: In 2019 a client let me go. (shows: Listen first)");
    expect(ctx.serialized).toContain("ONLY numbers, results and client details a draft may use");
    expect(ctx.serialized).toContain("140 managers coached [my records]");
    expect(ctx.serialized).toContain("Must never sound like: hustle bros");
    expect(ctx.serialized).toContain("Language: English, mixing in Hinglish (Hinglish on Instagram).");
    expect(ctx.serialized).toContain('"Get out of the car."  rather than  "Step back further."');
  });
});

describe("reading the web", () => {
  it("turns HTML into text and finds the article", () => {
    expect(htmlToText("<p>One &amp; two.</p><script>x()</script><p>Three&nbsp;four.</p>")).toBe("One & two.\n\nThree four.");
    const page = "<html><head><title>My essay | My site</title></head><body><nav>Home About</nav><article><h1>My essay</h1><p>The real text.</p></article><footer>©</footer></body></html>";
    expect(extractArticle(page)).toEqual({ title: "My essay", text: "My essay\n\nThe real text." });
  });

  it("finds a site's feed and reads RSS, Atom and podcast transcripts", () => {
    expect(findFeedLink('<link rel="alternate" type="application/rss+xml" href="/feed.xml">', "https://me.com/blog")).toBe("https://me.com/feed.xml");
    const rss = `<?xml version="1.0"?><rss><channel><title>My blog</title><item><title>Post one</title><link>https://me.com/1</link><pubDate>Mon, 01 Sep 2025 10:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Hello there.</p>]]></content:encoded><podcast:transcript url="https://me.com/1.vtt" type="text/vtt"/></item></channel></rss>`;
    expect(looksLikeFeed(rss)).toBe(true);
    const f = parseFeed(rss);
    expect(f.title).toBe("My blog");
    expect(f.items[0]).toMatchObject({ title: "Post one", link: "https://me.com/1", transcript: { url: "https://me.com/1.vtt", type: "text/vtt" } });
    expect(htmlToText(f.items[0].html)).toBe("Hello there.");
    const atom = `<feed><title>Atom</title><entry><title>A</title><link rel="alternate" href="https://me.com/a"/><updated>2025-01-01</updated><summary>Short.</summary></entry></feed>`;
    expect(parseFeed(atom).items[0]).toMatchObject({ title: "A", link: "https://me.com/a", html: "Short." });
  });

  it("reads captions: VTT with rolling duplicates, and SRT", () => {
    const vtt = "WEBVTT\nKind: captions\n\n00:00:01.000 --> 00:00:03.000\nso the first thing\n\n00:00:03.000 --> 00:00:05.000\nso the first thing\nI tell new managers\n\nNOTE this is a note\nignored\n\n00:00:05.000 --> 00:00:07.000\n<c>is to stop.</c> Then listen.";
    expect(parseCaptions(vtt)).toBe("so the first thing I tell new managers is to stop.\nThen listen.");
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nHello.\n\n2\n00:00:02,000 --> 00:00:03,000\nIt's me.";
    expect(parseCaptions(srt)).toBe("Hello.\nIt's me.");
  });

  it("refuses anything that isn't the public internet", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.72.14", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
    for (const u of ["file:///etc/passwd", "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://intranet.local/", "https://me.com:8443/", "https://user:pw@me.com/", "not a url"]) {
      expect(() => checkUrl(u)).toThrow(WebImportError);
    }
    expect(checkUrl("https://me.com/blog").hostname).toBe("me.com");
  });

  it("knows where Substack and Medium keep feeds", () => {
    expect(feedFor("https://jane.substack.com")).toBe("https://jane.substack.com/feed");
    expect(feedFor("https://medium.com/@jane")).toBe("https://medium.com/feed/@jane");
    expect(feedFor("https://jane.com/blog")).toBeNull();
  });

  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  const getter = (pages: Record<string, { body: string; type?: string }>): Getter => async (url) => {
    const p = pages[url];
    if (!p) throw new WebImportError("Nothing was found at that address.");
    return { url, contentType: p.type ?? "text/html", body: p.body };
  };

  it("reads a single article, a site's feed, or a podcast's transcripts", async () => {
    const single = await importFromUrl("https://me.com/essay", getter({ "https://me.com/essay": { body: `<title>Essay</title><article><p>${words(60)}</p></article>` } }));
    expect(single.pieces).toHaveLength(1);
    expect(single.pieces[0]).toMatchObject({ externalId: "url:https://me.com/essay", channel: "newsletter", title: "Essay" });

    const blog = await importFromUrl("https://me.com/", getter({
      "https://me.com/": { body: '<link rel="alternate" type="application/rss+xml" href="https://me.com/rss">' },
      "https://me.com/rss": { type: "application/rss+xml", body: `<rss><channel><title>Me</title><item><title>P1</title><link>https://me.com/p1</link><description>${words(50)}</description></item><item><title>Tiny</title><description>Too short.</description></item></channel></rss>` },
    }));
    expect(blog.pieces.map((p) => p.externalId)).toEqual(["url:https://me.com/p1"]);
    expect(blog.note).toBe("Read 1 post from Me.");

    const pod = await importFromUrl("https://pod.me/feed", getter({
      "https://pod.me/feed": { type: "application/rss+xml", body: `<rss><channel><title>My Pod</title><item><title>Ep1</title><link>https://pod.me/1</link><podcast:transcript url="https://pod.me/1.vtt" type="text/vtt"/></item></channel></rss>` },
      "https://pod.me/1.vtt": { type: "text/vtt", body: `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${words(45)}` },
    }));
    expect(pod.pieces[0]).toMatchObject({ channel: "spoken", title: "Ep1" });
    expect(pod.note).toBe("Read 1 transcript from My Pod.");
  });
});

describe("YouTube: captions from their own channel", () => {
  it("prefers uploaded captions over automatic ones and reads VTT", async () => {
    const json = (o: unknown) => new Response(JSON.stringify(o));
    const seen: string[] = [];
    const f: FetchLike = async (url) => {
      seen.push(url);
      if (url.includes("/channels?")) return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] });
      if (url.includes("/playlistItems?")) return json({ items: [{ contentDetails: { videoId: "v1", videoPublishedAt: "2025-05-01T00:00:00Z" }, snippet: { title: "My talk" } }] });
      if (url.includes("/captions?")) return json({ items: [{ id: "asr1", snippet: { trackKind: "asr" } }, { id: "std1", snippet: { trackKind: "standard" } }] });
      if (url.includes("/captions/std1")) return new Response(`WEBVTT\n\n00:00:01.000 --> 00:00:09.000\n${Array.from({ length: 50 }, () => "talking").join(" ")}`);
      throw new Error(url);
    };
    const { pieces, videos } = await importYouTubeCaptions("tok", {}, f);
    expect(videos).toBe(1);
    expect(pieces[0]).toMatchObject({ externalId: "youtube:v1", channel: "spoken", visibility: "public", title: "My talk" });
    expect(seen.some((u) => u.includes("/captions/asr1"))).toBe(false);
    expect(seen.find((u) => u.includes("/captions/std1"))).toContain("tfmt=vtt");
  });
});

describe("a palette from a logo", () => {
  it("ignores transparent and white, keeps the dominant of near-duplicates, darkest first", () => {
    const px: number[] = [];
    const push = (n: number, r: number, g: number, b: number, a = 255) => { for (let i = 0; i < n; i++) px.push(r, g, b, a); };
    push(500, 255, 255, 255); // background
    push(500, 0, 0, 0, 0); // transparent
    push(300, 6, 14, 159); // brand blue
    push(200, 10, 18, 160); // the same blue, anti-aliased
    push(150, 255, 52, 41); // accent red
    push(2, 120, 200, 120); // stray pixels
    expect(paletteFromPixels(px)).toEqual(["#060E9F", "#FF3429"]);
  });
});

// ---- against the database ---------------------------------------------------------

let dbReachable = false;
let W: WorkspaceScope;
const owner = () => ({ userId: W.userId!, role: "client" as const });

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const r = await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    const t = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('Enrich test') RETURNING id")).rows[0].id;
    const u = (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,'enrich@test.local','client','active') RETURNING id", [t])).rows[0].id;
    return { t, u };
  });
  W = { tenantId: r.t, userId: r.u, isPlatformAdmin: false };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) => c.query("DELETE FROM tenants WHERE id = $1", [W.tenantId]));
  await appPool().end();
});

describe("enrichment in the database", () => {
  it("pre-fills once per basis, and again when there's new writing", async () => {
    if (!dbReachable) return;
    const { loadPackForWorkspace, addSamples } = await import("@/lib/data/voice-pack");
    const { suggestAnswers } = await import("@/lib/data/enrich");
    const { finishIngest } = await import("@/lib/data/onboarding");
    let p = (await loadPackForWorkspace(W))!;
    await addSamples(W, p.id, [{ body: "Delegation is a skill you practise. What would you stop doing first? Start there.", channel: "linkedin" }]);
    await finishIngest(W, p);
    p = (await loadPackForWorkspace(W))!;
    const first = await suggestAnswers(W, p);
    expect(first.E1).toBeDefined();
    p = (await loadPackForWorkspace(W))!;
    const basis = p.onboarding.suggestions!.basis;
    await suggestAnswers(W, p);
    expect((await loadPackForWorkspace(W))!.onboarding.suggestions!.basis).toBe(basis);
    await addSamples(W, p.id, [{ body: "A second piece about feedback, written plainly and kept short on purpose.", channel: "linkedin" }]);
    await finishIngest(W, p);
    p = (await loadPackForWorkspace(W))!;
    await suggestAnswers(W, p);
    expect((await loadPackForWorkspace(W))!.onboarding.suggestions!.basis).not.toBe(basis);
  });

  it("sets dials from picks and keeps the chosen lines as paired examples", async () => {
    if (!dbReachable) return;
    const { loadPackForWorkspace } = await import("@/lib/data/voice-pack");
    const { pairsFor, savePicks } = await import("@/lib/data/enrich");
    let p = (await loadPackForWorkspace(W))!;
    const pairs = await pairsFor(W, p);
    expect(pairs).toHaveLength(8);
    p = (await loadPackForWorkspace(W))!;
    await savePicks(W, owner(), p, [
      { dial: "casual_formal", side: "left" },
      { dial: "fun_serious", side: "right" },
      { dial: "cheeky_respectful", side: "neither" },
    ]);
    p = (await loadPackForWorkspace(W))!;
    expect(p.identity.dials?.value).toMatchObject({ casual_formal: 3, fun_serious: 8, cheeky_respectful: 5 });
    expect(p.index.dials.casual_formal).toBe(3);
    expect(p.identity.preferences?.value).toHaveLength(2);
    expect(p.identity.preferences?.value[0].chosen).toBe(pairs.find((x) => x.dial === "casual_formal")!.left);
    expect(p.onboarding.answered).toContain("C4");
  });

  it("caches the preview per version and refreshes it after a change", async () => {
    if (!dbReachable) return;
    const { loadPackForWorkspace } = await import("@/lib/data/voice-pack");
    const { previewFor, saveInfluences } = await import("@/lib/data/enrich");
    let p = (await loadPackForWorkspace(W))!;
    const a = await previewFor(W, p);
    expect(a.text).toContain("It's not");
    p = (await loadPackForWorkspace(W))!;
    expect(p.onboarding.preview?.version).toBe(p.version);
    await saveInfluences(W, owner(), p, { admire: ["Morgan Housel"], avoid: [] });
    p = (await loadPackForWorkspace(W))!;
    expect(p.onboarding.preview?.version).not.toBe(p.version);
    await previewFor(W, p);
    expect((await loadPackForWorkspace(W))!.onboarding.preview?.version).toBe(p.version);
  });

  it("saves stories, facts, influences and languages, tidied", async () => {
    if (!dbReachable) return;
    const { loadPackForWorkspace } = await import("@/lib/data/voice-pack");
    const { saveStories, saveProofs, saveInfluences, saveLanguages } = await import("@/lib/data/enrich");
    const fresh = async () => (await loadPackForWorkspace(W))!;
    await saveStories(W, owner(), await fresh(), [{ title: " The pivot ", body: " We nearly closed. " }, { title: "", body: "no title" }]);
    await saveProofs(W, owner(), await fresh(), [{ claim: "140 managers coached", source: "" }, { claim: "  " }]);
    await saveInfluences(W, owner(), await fresh(), { admire: ["A", "A", " "], avoid: ["B"] });
    await saveLanguages(W, owner(), await fresh(), { primary: "en", also: ["hinglish", "en"], when: "" });
    const p = await fresh();
    expect(p.identity.stories?.value).toEqual([{ title: "The pivot", body: "We nearly closed." }]);
    expect(p.identity.proofs?.value).toEqual([{ claim: "140 managers coached" }]);
    expect(p.identity.influences?.value).toEqual({ admire: ["A"], avoid: ["B"] });
    expect(p.identity.languages?.value).toEqual({ primary: "en", also: ["hinglish"] });
  });

  it("accepts a headshot as its own kind of asset (0014)", async () => {
    if (!dbReachable) return;
    const { uploadAsset, listAssets } = await import("@/lib/data/assets");
    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "me.png", { type: "image/png" });
    await uploadAsset(W, png, "headshot");
    expect((await listAssets(W)).some((a) => a.kind === "headshot")).toBe(true);
    await expect(uploadAsset(W, new File(["x"], "me.svg", { type: "image/svg+xml" }), "headshot")).rejects.toThrow(/unsupported/);
  });
});

