/**
 * Markdown emphasis removed from the words a visual draws (lib/visual/markers).
 * The WhatsApp format writes *bold*; the picture and the templates must not
 * show the asterisks.
 */
import { describe, it, expect } from "vitest";
import { stripMarkers } from "@/lib/visual/markers";

describe("stripMarkers: emphasis that would show on a visual", () => {
  it("takes the markers off words wrapped on one line", () => {
    expect(stripMarkers("Send *this* today")).toBe("Send this today");
    expect(stripMarkers("A **bold** claim")).toBe("A bold claim");
    expect(stripMarkers("Just _italic_ here")).toBe("Just italic here");
    expect(stripMarkers("*Start* with **one** thing")).toBe("Start with one thing");
  });

  it("keeps the characters that are not emphasis", () => {
    expect(stripMarkers("5 * 3 * 2 is 30")).toBe("5 * 3 * 2 is 30");
    expect(stripMarkers("snake_case_name stays")).toBe("snake_case_name stays");
    expect(stripMarkers("a*b*c")).toBe("a*b*c");
    expect(stripMarkers("a lone * asterisk")).toBe("a lone * asterisk");
  });

  it("does not reach across a line break", () => {
    expect(stripMarkers("*open\nclose*")).toBe("*open\nclose*");
  });
});
