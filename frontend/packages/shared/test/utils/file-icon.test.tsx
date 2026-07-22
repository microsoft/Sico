/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { describe, expect, it } from "vitest";

import { iconForFilename, UrlIcon } from "@/utils/file-icon";

describe("iconForFilename", () => {
  it("maps file types to the Figma-aligned icon, generic file as fallback", () => {
    const fallback = iconForFilename("weird.zzz"); // unknown → generic file
    expect(iconForFilename("a.pdf")).toBe(fallback);
    expect(iconForFilename("a.md")).toBe(fallback);
    expect(iconForFilename("a.docx")).toBe(iconForFilename("a.doc"));
    expect(iconForFilename("a.csv")).toBe(iconForFilename("a.xlsx"));
    expect(iconForFilename("a.ts")).toBe(iconForFilename("a.js"));
    // `url` maps to a stroke-pinned IconWorld wrapper, not the raw glyph — its
    // rendered output (world glyph @ stroke-width 1.5) is asserted in
    // file-tile.test.tsx.
  });

  it("maps an .html file to the globe icon (it previews as a webpage)", () => {
    // A .html file renders through the sandboxed HtmlFileViewer as a webpage,
    // so its glyph is the globe — the same UrlIcon a web-preview deliverable
    // uses — keeping the chip + sidepane header consistent with the content.
    // Only `html` (not `htm`) maps, matching file-subtype's html-only parity.
    expect(iconForFilename("page.html")).toBe(UrlIcon);
  });

  it("resolves an http(s) URL to the globe wrapper regardless of its tail", () => {
    // A URL ending in `.pdf` must NOT resolve to the PDF icon — the URL form is
    // detected first and pinned to the globe.
    expect(iconForFilename("https://example.com/doc.pdf")).toBe(UrlIcon);
    expect(iconForFilename("https://example.com/page")).toBe(UrlIcon);
  });

  // A filename whose "extension" collides with an Object.prototype key
  // (`__proto__`, `constructor`, `toString`, …) used to leak the prototype
  // value past the fallback guard — a non-component that crashes createElement.
  it("falls back to generic file for prototype-chain extension names", () => {
    const fallback = iconForFilename("weird.zzz");
    expect(iconForFilename("x.__proto__")).toBe(fallback);
    expect(iconForFilename("x.constructor")).toBe(fallback);
    expect(iconForFilename("x.toString")).toBe(fallback);
  });
});
