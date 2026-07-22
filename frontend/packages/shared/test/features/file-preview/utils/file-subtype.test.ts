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

import {
  type FileSubtype,
  fileSubtype,
} from "@/features/file-preview/utils/file-subtype";

// Every extension → subtype branch (ported 1:1 from legacy FileDrawer
// getFileType). The base host is irrelevant — only the pathname extension is
// read — so a fully-qualified SAS-style url stands in for each case.
const url = (name: string): string => `https://blob.test/files/${name}`;

describe("fileSubtype", () => {
  it.each<[string, FileSubtype]>([
    ["doc", "office"],
    ["docx", "office"],
    ["xls", "office"],
    ["xlsx", "office"],
    ["ppt", "office"],
    ["pptx", "office"],
    ["pdf", "pdf"],
    ["glb", "glb"],
    ["md", "markdown"],
    ["txt", "text"],
    ["html", "html"],
    ["png", "image"],
    ["jpg", "image"],
    ["jpeg", "image"],
    ["gif", "image"],
    ["bmp", "image"],
    ["webp", "image"],
    ["svg", "image"],
    ["mp4", "video"],
    ["webm", "video"],
    ["ogg", "video"],
    ["mov", "video"],
  ])("maps a .%s file to the %s subtype", (ext, expected) => {
    expect(fileSubtype(url(`report.${ext}`))).toBe(expected);
  });

  it("matches the extension case-insensitively (uppercase .PDF → pdf)", () => {
    expect(fileSubtype(url("REPORT.PDF"))).toBe("pdf");
  });

  it("ignores a trailing query string (SAS token) when reading the extension", () => {
    expect(fileSubtype(url("report.pdf?sv=2024&sig=abc"))).toBe("pdf");
  });

  it("reads the LAST extension on a multi-dotted name", () => {
    expect(fileSubtype(url("archive.tar.gz"))).toBe("unknown");
    expect(fileSubtype(url("slides.final.pptx"))).toBe("office");
  });

  it("returns 'unknown' for a recognized-but-unmapped extension (htm is NOT html)", () => {
    // Legacy mapped only 'html', never 'htm' — preserve that exactly.
    expect(fileSubtype(url("page.htm"))).toBe("unknown");
  });

  it("returns 'unknown' for an unrecognized extension", () => {
    expect(fileSubtype(url("data.xyz"))).toBe("unknown");
  });

  it("returns 'unknown' for csv (Office Online's embed can't render it)", () => {
    // csv routes to the download fallback, NOT the office viewer: Microsoft's
    // Office Online embed returns "File not found" for .csv (verified live),
    // even though Excel desktop opens it. See the csv-preview tracking issue.
    expect(fileSubtype(url("data.csv"))).toBe("unknown");
  });

  it("returns 'unknown' when the path has no extension", () => {
    expect(fileSubtype("https://blob.test/files/report")).toBe("unknown");
  });

  it("returns 'unknown' for an empty url", () => {
    expect(fileSubtype("")).toBe("unknown");
  });

  it("returns 'unknown' for a malformed url that fails to parse", () => {
    // A lone scheme is treated as absolute, so the base can't rescue it — `new
    // URL` throws and the deliberate catch falls back to 'unknown'.
    expect(fileSubtype("http://")).toBe("unknown");
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "returns 'unknown' for an Object.prototype key extension (.%s)",
    (protoKey) => {
      // An agent-authored filename ending in a prototype key must NOT leak the
      // prototype member through the bracket lookup — `Object.hasOwn` gates it
      // back to 'unknown', keeping the FileSubtype return-type contract sound.
      expect(fileSubtype(url(`report.${protoKey}`))).toBe("unknown");
    },
  );
});
