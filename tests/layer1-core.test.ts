/**
 * Layer 1 completion: the Visual Core (site extraction, tokens, prompt lines),
 * beliefs in the context, and the Perception Mirror.
 */
import { describe, it, expect } from "vitest";
import { cleanCore, extractSiteBrand, visualCoreLines, visualTokens, TEMPLATE_KIT } from "@/lib/visual/core";
import { buildBrandContext, CONTEXT_VERSION } from "@/lib/context/context-builder";
import { perceptionMirror } from "@/lib/voice/mirror";
import { emptyIndex, tagged, type VoicePack } from "@/lib/voice/types";

const HTML = `<html><head>
<meta name="theme-color" content="#ff3429">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600&amp;family=Instrument+Serif:ital@0;1" rel="stylesheet">
<link rel="stylesheet" href="/site.css"><link rel="icon" href="/favicon.png">
</head><body><img class="site-logo" src="/img/logo.svg" alt="Okra"></body></html>`;
const CSS = `body{font-family:-apple-system,Helvetica;color:#111111;background:#FAFAFA} h1{font-family:"Archivo",sans-serif;color:#FF3429}
a{color:#ff3429} .btn{background:#1E3A8A} .tag{background:#1e3a8a} p{color:#666}`;

describe("reading a brand off its website", () => {
  it("finds the theme colour, the brand colours, fonts and the logo", () => {
    const b = extractSiteBrand(HTML, [CSS], "https://okra.example/");
    expect(b.palette[0]).toBe("#FF3429");
    expect(b.palette).toContain("#1E3A8A");
    expect(b.palette).toContain("#111111");
    expect(b.fonts).toEqual(["Archivo", "Instrument Serif"]);
    expect(b.logo).toBe("https://okra.example/img/logo.svg");
    expect(b.stylesheets).toEqual(["https://okra.example/site.css"]);
  });
  it("drops system font stacks and copes with an empty page", () => {
    expect(extractSiteBrand("<html></html>", ["body{font-family:system-ui,sans-serif}"], "https://x.example").fonts).toEqual([]);
  });
});

describe("the Visual Core", () => {
  const core = cleanCore({ roles: { "#ff3429": "Headlines and buttons only", "nope": "x" }, layout: " One column ", motifs: "A red dot", references: ["a", "a", "b", "c", "d"] });
  it("keeps only real colours and at most three references", () => {
    expect(core.roles).toEqual({ "#FF3429": "Headlines and buttons only" });
    expect(core.references).toEqual(["a", "b", "c"]);
  });
  it("exports a token file with each colour's use and the template kit", () => {
    const t = visualTokens({ brand: "Alex", palette: ["#0a0a0a", "#ff3429"], fonts: ["Archivo", "Inter"], imageStyleNotes: "", core });
    expect(t.color[1]).toEqual({ hex: "#FF3429", role: "accent", use: "Headlines and buttons only" });
    expect(t.font[0]).toEqual({ family: "Archivo", role: "heading" });
    expect(t.templates.map((x) => x.key)).toEqual(TEMPLATE_KIT.map((x) => x.key));
  });
  it("reaches the prompt through the one context builder", () => {
    const ctx = buildBrandContext({ visualIdentity: { palette: ["#FF3429"], coreLines: visualCoreLines(core) } });
    expect(CONTEXT_VERSION).toBe(6);
    expect(ctx.serialized).toContain("Colour use: #FF3429 for Headlines and buttons only");
    expect(ctx.serialized).toContain("Motifs: A red dot");
  });
});

describe("beliefs and the Perception Mirror", () => {
  it("puts beliefs in the voice block", () => {
    const ctx = buildBrandContext({ voicePack: { beliefs: ["Most brand problems are clarity problems."] } as never });
    expect(ctx.serialized).toContain("Most brand problems are clarity problems.");
  });
  it("names a wide gap between intended and seen, and position coverage", () => {
    const pack = {
      identity: { dials: tagged({ fun_serious: 2, casual_formal: 8 }, "ask"), carries: tagged("Clarity beats charisma", "ask") },
      index: { ...emptyIndex(), dials: {} },
      mechanics: {
        punctuation: tagged({ exclamation: 0, emoji: 0, question: 0, ellipsis: 0, emDash: 0, colon: 0, semicolon: 0, parenthesis: 0 }, "measured"),
        contractions: tagged(0.9, "measured"),
      },
    } as unknown as VoicePack;
    const rows = perceptionMirror(pack, ["Clarity wins every time.", "A note about holidays."], "");
    const fun = rows.find((r) => r.label === "Fun or serious")!;
    expect(fun.gap).toBe("wide");
    const pos = rows.find((r) => r.label === "On your position")!;
    expect(pos.seen).toContain("50%");
  });
});
