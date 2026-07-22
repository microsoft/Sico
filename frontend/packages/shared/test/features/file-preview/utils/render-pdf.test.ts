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

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPdf } from "@/features/file-preview/utils/render-pdf";

// loadPdf is a thin wrapper over pdfjs getDocument — here we only assert it
// passes the cMap / standard-font asset URLs so CJK / non-embedded-font PDFs
// render (without them pdfjs silently drops those glyphs). pdfjs itself can't
// run in jsdom, so the module is stubbed to a spy.
const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadPdf", () => {
  it("passes the document url to pdfjs", () => {
    loadPdf("https://blob.test/doc.pdf");
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://blob.test/doc.pdf" }),
    );
  });

  it("points pdfjs at the app-hosted cMap + standard-font assets", () => {
    // Self-hosted under the app's BASE_URL/pdfjs/ (matches legacy), so CJK and
    // non-embedded-font PDFs render. cMaps are packed (.bcmap binaries).
    loadPdf("https://blob.test/doc.pdf");
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
      }),
    );
  });
});
