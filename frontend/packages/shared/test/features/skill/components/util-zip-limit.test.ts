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

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  assertSafeAssetUrl,
  buildSkillFilesFromDownload,
} from "@/features/skill/utils/file-utils";

const encoder = new TextEncoder();

describe("buildSkillFilesFromDownload — zip extraction", () => {
  it("extracts entries from a normal zip archive", () => {
    const zip = zipSync({
      "skill.md": encoder.encode("# hello"),
      "notes.txt": encoder.encode("plain text"),
    });
    const files = buildSkillFilesFromDownload(zip, "skill.zip");
    expect(files.map((f) => f.path)).toEqual(["notes.txt", "skill.md"]);
    expect(files.find((f) => f.path === "skill.md")?.content).toBe("# hello");
  });

  it("rejects an archive whose decompressed size exceeds the cap", () => {
    // A ~200MB+ entry: decompresses far past the extraction budget. A real zip
    // bomb ships this compressed to a few KB; here the point is that extraction
    // must abort on the declared size before inflating, not OOM the tab.
    const huge = new Uint8Array(201 * 1024 * 1024);
    const zip = zipSync({ "bomb.bin": huge }, { level: 0 });
    expect(() => buildSkillFilesFromDownload(zip, "skill.zip")).toThrow(
      /too large/i,
    );
  });

  it("skips entries with a traversal (..) segment", () => {
    const zip = zipSync({
      "skill.md": encoder.encode("# ok"),
      "../escape.txt": encoder.encode("nope"),
      "a/../../b.txt": encoder.encode("nope"),
    });
    const files = buildSkillFilesFromDownload(zip, "skill.zip");
    expect(files.map((f) => f.path)).toEqual(["skill.md"]);
  });
});

describe("assertSafeAssetUrl", () => {
  it.each(["https://cdn.example.com/skill.zip", "blob:abc", "/api/skill.zip"])(
    "passes through a safe url: %s",
    (url) => {
      expect(assertSafeAssetUrl(url)).toBe(url);
    },
  );

  it.each([
    // eslint-disable-next-line no-script-url -- these hostile URLs are the input under test: assertSafeAssetUrl must reject them
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
  ])("rejects an off-scheme url: %s", (url) => {
    expect(() => assertSafeAssetUrl(url)).toThrow(/unsupported|invalid/i);
  });
});
