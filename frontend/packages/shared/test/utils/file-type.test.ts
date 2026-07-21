import { describe, expect, it } from "vitest";

import { extensionOf, isImageFilename, isUrl } from "@/utils/file-type";

describe("file-type helpers", () => {
  it("extracts the lowercased extension, '' when none", () => {
    expect(extensionOf("a.PDF")).toBe("pdf");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("noext")).toBe("");
  });

  it("detects image filenames case-insensitively", () => {
    expect(isImageFilename("photo.PNG")).toBe(true);
    expect(isImageFilename("a.jpeg")).toBe(true);
    expect(isImageFilename("notes.pdf")).toBe(false);
    expect(isImageFilename("noext")).toBe(false);
  });

  it("detects http(s) URLs", () => {
    expect(isUrl("https://example.com/doc.pdf")).toBe(true);
    expect(isUrl("http://example.com")).toBe(true);
    expect(isUrl("ftp://example.com")).toBe(false);
    expect(isUrl("report.xlsx")).toBe(false);
  });
});
