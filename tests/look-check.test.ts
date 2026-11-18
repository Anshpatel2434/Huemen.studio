/**
 * Hue Check, "On-brand look?" (lib/visual/look-check). Pure.
 *
 * The badge has to be honest (owner, 2026-11-17): a plain card of text on
 * black scored "100 · On brand" because only contrast, length and "are these
 * colours yours" were measured, and with no palette the house black and white
 * counted as the brand's. Now:
 *
 *   - no palette is a finding, never "every colour is yours"
 *   - nothing of the brand on the visual (neutral colours, no brand font, no
 *     logo, no picture) can't be On brand: it tops out at Drifting
 *   - the score rewards what makes it the person's own: a brand colour in
 *     use, the brand font rendering, the logo sign-off, a picture
 *   - text that was cut off to fit can't be On brand
 */
import { describe, it, expect } from "vitest";
import { lookCheck } from "@/lib/visual/look-check";
import { schemesFrom } from "@/lib/visual/schemes";

const T = { scale: 1, background: "scheme" as const, accent: "subtle" as const };
const base = { palette: ["#0A0A0A", "#FF3429", "#FFFFFF"], fonts: ["Archivo"], tweaks: T, headline: "Clarity beats charisma." };
const ownScheme = { bg: "#FFFFFF", fg: "#0A0A0A", accent: "#FF3429" };

/** The owner's example: text on black, nothing else. No palette, no brand font, no logo, no picture. */
const plainBlack = { palette: [], fonts: [], tweaks: T, headline: "We are thrilled to announce a new offering.", scheme: schemesFrom([])[1] };
/** A card that carries the brand: its green on its cream, its font rendering, its logo on the sign-off. */
const branded = {
  palette: ["#F6F1E9", "#1F4D3A", "#141414"], fonts: ["Archivo"], tweaks: T, headline: "Clarity beats charisma.",
  scheme: schemesFrom(["#F6F1E9", "#1F4D3A", "#141414"])[0], fontRendering: true, logo: true,
};

describe("Hue Check: on-brand look", () => {
  it("a plain black text card is Drifting, not On brand (it scored 100 before with a font named, 88 without)", () => {
    expect(plainBlack.scheme).toMatchObject({ bg: "#0a0a0a", fg: "#ffffff" });
    const r = lookCheck(plainBlack);
    expect(r.score).toBe(65);
    expect(r.band).toBe("drift");
    // No palette is said plainly; black and white are never called "yours".
    expect(r.findings.some((f) => f.verdict === "drift" && /No brand colours set, so black and white stand in/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /one of yours|is in use/i.test(f.text))).toBe(false);
    // It says what is missing and where to add it.
    const missing = r.findings.find((f) => /Nothing here is yours yet/.test(f.text));
    expect(missing?.verdict).toBe("drift");
    expect(missing?.text).toMatch(/Brand core/);
    expect(r.findings.some((f) => /No brand fonts set/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /No logo on the sign-off/.test(f.text))).toBe(true);
    // The text itself is fine, and says so: sound, just not theirs.
    expect(r.findings.some((f) => f.verdict === "on" && /reads clearly/.test(f.text))).toBe(true);
  });

  it("naming a font in the brand core doesn't buy the badge when the font isn't rendering", () => {
    const named = lookCheck({ ...plainBlack, fonts: ["Borna"], fontRendering: false });
    expect(named.score).toBe(65);
    expect(named.band).toBe("drift");
    expect(named.findings.some((f) => /Borna isn't loading here/.test(f.text))).toBe(true);
  });

  it("a monochrome palette is still nothing brand-specific: the same black card stays Drifting", () => {
    const r = lookCheck({ ...plainBlack, palette: ["#000000", "#FFFFFF", "#F4F4F4"], scheme: schemesFrom(["#000000", "#FFFFFF", "#F4F4F4"])[0] });
    expect(r.band).toBe("drift");
    expect(r.score).toBe(65);
    expect(r.findings.some((f) => /black, white and grey, which any brand could be using/.test(f.text))).toBe(true);
    // The same brand with its own font rendering and its logo on is On brand without a colour.
    const own = lookCheck({ ...plainBlack, palette: ["#000000", "#FFFFFF", "#F4F4F4"], scheme: schemesFrom(["#000000", "#FFFFFF", "#F4F4F4"])[0], fonts: ["Borna"], fontRendering: true, logo: true });
    expect(own.score).toBe(85);
    expect(own.band).toBe("on");
  });

  it("a fully branded card is On brand at 100, every finding green", () => {
    const r = lookCheck(branded);
    expect(r.score).toBe(100);
    expect(r.band).toBe("on");
    expect(r.findings.every((f) => f.verdict === "on")).toBe(true);
    expect(r.findings.some((f) => /Your colour #1F4D3A is in use/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /Set in your font, Archivo/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /Your logo signs it off/.test(f.text))).toBe(true);
    expect(lookCheck({ ...branded, picture: true }).findings.some((f) => /carries a picture/.test(f.text))).toBe(true);
  });

  it("rewards each sign of the brand, and a picture can stand in for one", () => {
    const score = (extra: object) => lookCheck({ ...branded, fontRendering: false, logo: false, tweaks: { ...T, accent: "none" as const }, ...extra }).score;
    const none = score({});
    const colour = score({ tweaks: T });
    const font = score({ fontRendering: true });
    const logo = score({ logo: true });
    const picture = score({ picture: true });
    expect(none).toBe(65);
    expect([colour, font, logo, picture]).toEqual([80, 77, 73, 73]);
    expect(score({ tweaks: T, fontRendering: true })).toBe(92);
    expect(score({ tweaks: T, logo: true })).toBe(88);
    // Colour and font and logo are the full mark; a picture on top doesn't go past 100.
    expect(score({ tweaks: T, fontRendering: true, logo: true, picture: true })).toBe(100);
    // No logo, but a picture: the picture stands in.
    expect(score({ tweaks: T, fontRendering: true, picture: true })).toBe(100);
  });

  it("a brand colour only counts when it is actually on the visual", () => {
    // Accent off: the brand's green isn't drawn anywhere, only cream and near-black.
    const off = lookCheck({ ...branded, tweaks: { ...T, accent: "none" } });
    expect(off.findings.some((f) => f.verdict === "drift" && /None of your brand colours shows here/.test(f.text))).toBe(true);
    expect(off.score).toBe(85);
    // An accent that can't be seen on this ground isn't drawn (the ink is), so it doesn't count either.
    const hidden = lookCheck({ ...branded, palette: ["#FFFFFF", "#FFF4B8", "#111111"], scheme: { bg: "#FFFFFF", fg: "#111111", accent: "#FFF4B8" } });
    expect(hidden.findings.some((f) => /is in use/.test(f.text))).toBe(false);
    // A tint of the accent is the accent in use.
    const tint = lookCheck({ ...branded, tweaks: { ...T, accent: "none", background: "tint" } });
    expect(tint.findings.some((f) => /Your colour #1F4D3A is in use/.test(f.text))).toBe(true);
  });

  it("text that was cut off to fit is never On brand, however branded the card", () => {
    const r = lookCheck({ ...branded, picture: true, fit: "clamped" });
    expect(r.band).not.toBe("on");
    expect(r.score).toBeLessThan(85);
    expect(r.findings.some((f) => f.verdict === "off" && /cut off with an ellipsis/.test(f.text))).toBe(true);
    // Stepped down to fit, but all there: fine.
    expect(lookCheck({ ...branded, fit: "shrunk" }).band).toBe("on");
    expect(lookCheck({ ...branded, fit: "ok" }).score).toBe(100);
  });

  it("a heading drawn into the picture is never On brand until its spelling is checked", () => {
    // The owner's case (2026-11-17): a fully branded card with a garbled drawn-in heading scored 88 On brand.
    const drawn = lookCheck({ ...branded, picture: true, drawnIn: true });
    expect(drawn.band).not.toBe("on");
    expect(drawn.score).toBeLessThanOrEqual(84);
    const spelling = drawn.findings.find((f) => /The heading drawn into the picture may not be spelled right/.test(f.text));
    expect(spelling?.verdict).toBe("drift");
    // Not credited to the brand font either: the words are in the picture, not in the font.
    expect(drawn.findings.some((f) => /Set in your font/.test(f.text))).toBe(false);
    // Live text is still checked as before.
    expect(lookCheck({ ...branded, picture: true, drawnIn: false }).band).toBe("on");
    expect(lookCheck({ ...branded, picture: true, drawnIn: false }).findings.some((f) => /may not be spelled right/.test(f.text))).toBe(false);
  });

  it("passes a scheme made from the brand's colours with readable text", () => {
    const r = lookCheck({ ...base, scheme: ownScheme, logo: true });
    expect(r.band).toBe("on");
    expect(r.findings.every((f) => f.verdict === "on")).toBe(true);
  });

  it("flags colours that aren't the brand's", () => {
    const r = lookCheck({ ...base, scheme: { bg: "#FFFFFF", fg: "#DDDDDD", accent: "#00FF00" }, logo: true });
    expect(r.findings.some((f) => f.verdict === "drift" && /#00FF00 isn't in your palette/.test(f.text))).toBe(true);
    expect(r.band).not.toBe("on");
    // The templates never draw unreadable text: a faint ink is swapped for one that reads, and the check measures what is drawn.
    expect(r.findings.some((f) => /hard to read/.test(f.text))).toBe(false);
  });

  it("flags a headline too long for one image, a hidden logo and missing brand fonts", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const r = lookCheck({ ...base, fonts: [], headline: long, scheme: ownScheme, logoHidden: true });
    expect(r.findings.some((f) => f.verdict === "off" && /40 words/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /No brand fonts/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /logo is hidden on this piece/.test(f.text))).toBe(true);
    expect(r.band).toBe("off");
  });

  it("stays within 0 to 100 and keeps the three bands", () => {
    const worst = lookCheck({ ...plainBlack, headline: Array.from({ length: 60 }, () => "word").join(" "), scheme: { bg: "#FFFFFF", fg: "#00FF00", accent: "#FF00FF" }, tweaks: { ...T, accent: "bold", scale: 1.4 }, fit: "clamped" });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.band).toBe("off");
    for (const r of [lookCheck(plainBlack), lookCheck(branded), worst]) expect(["on", "drift", "off"]).toContain(r.band);
  });
});
