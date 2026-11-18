import { describe, expect, it } from "vitest";
import { colourName } from "@/components/colour-name";

/** Brand core › Visual names each colour in plain words (2026-11-18 run: #F5F1E8 was "Soft gold"). */
describe("colourName", () => {
  it("names a very light, low-chroma warm colour as a cream, not a gold", () => {
    const n = colourName("#F5F1E8");
    expect(n).toMatch(/cream|ivory|off-white/i);
    expect(n).not.toMatch(/gold/i);
  });

  it("keeps real golds gold", () => {
    expect(colourName("#C8A96A")).toMatch(/gold/i);
  });

  it("names a deep forest green green", () => {
    expect(colourName("#1E4D3B")).toMatch(/green/i);
  });

  it("names a near-black ink", () => {
    expect(colourName("#1A1A1A")).toMatch(/ink|black/i);
  });

  it("names other near-whites by how they read", () => {
    expect(colourName("#FFFFFF")).toBe("White");
    expect(colourName("#FFF8F0")).toMatch(/ivory|cream/i);
    expect(colourName("#EEF2EC")).toMatch(/off-white/i);
    for (const hex of ["#F6F1E9", "#FAFAF7", "#F4EFE6"]) expect(colourName(hex)).not.toMatch(/gold|yellow|orange/i);
  });

  it("still names saturated colours by hue", () => {
    expect(colourName("#FF3429")).toMatch(/red/i);
    expect(colourName("#0047FF")).toMatch(/blue/i);
  });
});
