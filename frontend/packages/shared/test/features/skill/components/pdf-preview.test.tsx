import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PdfPreview } from "@/features/skill/components/file-explorer/pdf-preview";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({ numPages: 0 }),
    destroy: vi.fn(),
  })),
}));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:x");
});

describe("PdfPreview", () => {
  it("renders the pdf.js canvas container", () => {
    const { container } = render(<PdfPreview fileUrl="blob:x" />);
    expect(container.firstChild).toBeTruthy();
  });
});
