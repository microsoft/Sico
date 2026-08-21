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
