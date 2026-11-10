import { describe, it, expect } from "vitest";
import { lookCheck } from "@/lib/visual/look-check";

const T = { scale: 1, background: "scheme" as const, accent: "subtle" as const };
const base = { palette: ["#0A0A0A", "#FF3429", "#FFFFFF"], fonts: ["Archivo"], tweaks: T, headline: "Clarity beats charisma." };

describe("Hue Check: on-brand look", () => {
  it("passes a scheme made from the brand's colours with readable text", () => {
    const r = lookCheck({ ...base, scheme: { bg: "#FFFFFF", fg: "#0A0A0A", accent: "#FF3429" } });
    expect(r.band).toBe("on");
    expect(r.findings.every((f) => f.verdict === "on")).toBe(true);
  });
  it("flags colours that aren't the brand's, and unreadable text", () => {
    const r = lookCheck({ ...base, scheme: { bg: "#FFFFFF", fg: "#DDDDDD", accent: "#00FF00" } });
    expect(r.findings.some((f) => /isn't in your palette/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => f.verdict === "off" && /hard to read/.test(f.text))).toBe(true);
    expect(r.band).not.toBe("on");
  });
  it("flags a headline too long for one image, and missing brand fonts", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const r = lookCheck({ ...base, fonts: [], headline: long, scheme: { bg: "#FFFFFF", fg: "#0A0A0A", accent: "#FF3429" } });
    expect(r.findings.some((f) => f.verdict === "off" && /40 words/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /No brand fonts/.test(f.text))).toBe(true);
  });
});
