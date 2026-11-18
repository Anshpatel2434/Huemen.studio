import { describe, expect, it } from "vitest";
import { cleanModelText, visualText } from "./clean";

describe("visualText (markdown out of pictures)", () => {
  it("takes WhatsApp bold out of a headline", () => {
    expect(visualText("*Bold* headline")).toBe("Bold headline");
    expect(visualText("Hook uses *bold* syntax, which is fine")).toBe("Hook uses bold syntax, which is fine");
  });

  it("takes double stars, underscores and tildes out", () => {
    expect(visualText("**double** stars")).toBe("double stars");
    expect(visualText("_italic_ word")).toBe("italic word");
    expect(visualText("~struck~ out")).toBe("struck out");
  });

  it("takes out several markers in one line", () => {
    expect(visualText("Send *this* now, not _that_.")).toBe("Send this now, not that.");
  });

  it("leaves a marker that does not wrap a word alone", () => {
    expect(visualText("3 * 4 * 5 is 60")).toBe("3 * 4 * 5 is 60");
    expect(visualText("a lone * star")).toBe("a lone * star");
  });

  it("leaves snake_case and plain text alone", () => {
    expect(visualText("snake_case_name and a plain line")).toBe("snake_case_name and a plain line");
  });

  it("does not change the stored copy: it is a separate function from the model clean-up", () => {
    expect(cleanModelText("*Bold* headline")).toBe("*Bold* headline");
  });
});
