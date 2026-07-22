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
  collectValidFiles,
  fileKey,
} from "@/features/projects/utils/collect-valid-files";

// `lastModified` is pinned so two `file("x")` calls model the SAME physical
// file picked twice (identical name + size + mtime) — the real-world duplicate.
function file(
  name: string,
  bytes = 1024,
  lastModified = 1_700_000_000_000,
): File {
  return new File([new Uint8Array(bytes)], name, {
    type: "application/pdf",
    lastModified,
  });
}

describe("fileKey", () => {
  it("is identical for files with the same name, size, and lastModified", () => {
    expect(fileKey(file("a.pdf"))).toBe(fileKey(file("a.pdf")));
  });

  it("differs when lastModified differs", () => {
    expect(fileKey(file("a.pdf", 1024, 1))).not.toBe(
      fileKey(file("a.pdf", 1024, 2)),
    );
  });
});

describe("collectValidFiles", () => {
  it("accepts supported types under the size + count limits", () => {
    const { accepted, errors } = collectValidFiles(
      [file("a.pdf"), file("b.docx"), file("c.xlsx")],
      [],
    );

    expect(accepted.map((f) => f.name)).toEqual(["a.pdf", "b.docx", "c.xlsx"]);
    expect(errors).toEqual([]);
  });

  it("rejects an unsupported extension with the wrong-type message", () => {
    const { accepted, errors } = collectValidFiles([file("notes.txt")], []);

    expect(accepted).toEqual([]);
    expect(errors).toEqual([
      `"notes.txt" isn't a supported type. Use pdf, docx, or xlsx.`,
    ]);
  });

  it("rejects a file larger than 10MB with the oversize message", () => {
    const { accepted, errors } = collectValidFiles(
      [file("big.pdf", 11 * 1024 * 1024)],
      [],
    );

    expect(accepted).toEqual([]);
    expect(errors).toEqual([
      `"big.pdf" is larger than 10MB. Try a smaller file.`,
    ]);
  });

  it("rejects files past the 5-file cap, counting already-added files", () => {
    const { accepted, errors } = collectValidFiles(
      [file("d.pdf"), file("e.pdf"), file("f.pdf")],
      [file("a.pdf"), file("b.pdf"), file("c.pdf"), file("g.pdf")],
    );

    // 4 existing + "d.pdf" fills the cap; the two remaining files each trip the
    // count gate (one message per excess file).
    expect(accepted.map((f) => f.name)).toEqual(["d.pdf"]);
    expect(errors).toEqual([
      "You can add up to 5 files at a time. Remove one to add another.",
      "You can add up to 5 files at a time. Remove one to add another.",
    ]);
  });

  it("silently skips a file already present in the existing list", () => {
    const { accepted, errors } = collectValidFiles(
      [file("a.pdf")],
      [file("a.pdf")],
    );

    expect(accepted).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("silently skips a duplicate within the same incoming batch", () => {
    const { accepted, errors } = collectValidFiles(
      [file("dup.pdf"), file("dup.pdf"), file("unique.pdf")],
      [],
    );

    expect(accepted.map((f) => f.name)).toEqual(["dup.pdf", "unique.pdf"]);
    expect(errors).toEqual([]);
  });

  it("does not let a skipped duplicate consume a count slot", () => {
    // 4 existing + a duplicate of one of them + one new file: the duplicate is
    // skipped before the count gate, so the new file still fits under the cap.
    const { accepted, errors } = collectValidFiles(
      [file("a.pdf"), file("e.pdf")],
      [file("a.pdf"), file("b.pdf"), file("c.pdf"), file("d.pdf")],
    );

    expect(accepted.map((f) => f.name)).toEqual(["e.pdf"]);
    expect(errors).toEqual([]);
  });
});
