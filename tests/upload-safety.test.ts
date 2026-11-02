/**
 * Upload safety: a file's type comes from its own bytes, SVGs with active
 * content are refused, and stored files are served locked down.
 */
import { describe, it, expect } from "vitest";
import { sniffType, svgProblem } from "@/lib/storage/sniff";

const bytes = (...xs: (number | string)[]) => new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const text = (s: string) => new TextEncoder().encode(s);

describe("what a file really is", () => {
  it("recognises the formats Huemen accepts by their first bytes", () => {
    expect(sniffType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("image/png");
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
    expect(sniffType(bytes("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffType(bytes(0x50, 0x4b, 0x03, 0x04, 20, 0))).toBe("application/zip");
    expect(sniffType(bytes("wOF2", 0, 1))).toBe("font/woff2");
    expect(sniffType(text('﻿<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
  });
  it("is not fooled by a name or a claimed type: HTML or a script stays unknown", () => {
    expect(sniffType(text("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffType(text("#!/bin/sh\nrm -rf /"))).toBeNull();
  });
});

describe("SVG with active content is refused", () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><path d="M0 0h10v10z" fill="url(#g)"/><use href="#g"/></svg>';
  it("keeps an ordinary logo, internal references included", () => {
    expect(svgProblem(text(ok))).toBeNull();
  });
  it.each([
    ['<svg><script>fetch("/x")</script></svg>', /script/],
    ['<svg onload="alert(1)"></svg>', /event handlers/],
    ["<svg><foreignObject><iframe/></foreignObject></svg>", /foreignObject/],
    ['<svg><a href="javascript:alert(1)"><rect/></a></svg>', /links to script/],
    ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>', /entities/],
    ['<svg><image href="https://tracker.example/p.gif"/></svg>', /elsewhere/],
    ["<svg><style>@import url(//evil.example/x.css);</style></svg>", /elsewhere/],
  ])("refuses %s", (svg, why) => {
    expect(svgProblem(text(svg))).toMatch(why);
  });
});

describe("serving stored files", () => {
  it("sends every file locked down: no type guessing, no scripts, images inline and the rest downloaded", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/storage/[...key]/route.ts", "utf8");
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
    expect(route).toMatch(/"Content-Security-Policy": "default-src 'none';[^"]*sandbox"/);
    expect(route).toContain("attachment");
  });
});
