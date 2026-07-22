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

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SidepaneContent } from "@/features/chat/atoms/sidepane-atom";
import { FilePreviewer } from "@/features/chat/components/sidepane/previewers/file-previewer";
import { downloadFile } from "@/utils/download-file";

// The IO is owned (and exhaustively tested) by download-file.test; here we mock
// it and assert the previewer wires it with the right url + filename.
vi.mock("@/utils/download-file", () => ({
  downloadFile: vi.fn(() => Promise.resolve()),
}));

// The pdf/glb viewers are code-split (pdfjs / babylon are MBs). Stub the lazy
// boundaries to sentinels so this DISPATCH test never pulls those chunks in —
// the viewers themselves are unit-tested in their own files; here we only prove
// FilePreviewer routes each subtype to the right one.
vi.mock("@/features/file-preview/components/viewers/lazy-pdf-viewer", () => ({
  LazyPdfViewer: ({ fileUrl }: { fileUrl: string }) => (
    <div data-testid="lazy-pdf" data-url={fileUrl} />
  ),
}));
vi.mock("@/features/file-preview/components/viewers/lazy-glb-viewer", () => ({
  LazyGlbViewer: ({ fileUrl }: { fileUrl: string }) => (
    <div data-testid="lazy-glb" data-url={fileUrl} />
  ),
}));

// The button's own behavior (agent query → POST → toast) is covered in
// add-to-project-button.test; here we only prove FilePreviewer mounts it when —
// and only when — the content is a deliverable (`canAddToProject`).
vi.mock("@/features/chat/components/sidepane/add-to-project-button", () => ({
  AddToProjectButton: () => <div data-testid="add-to-project" />,
}));

type FileContent = Extract<SidepaneContent, { kind: "file" }>;

// Fresh fixture per test — the sidepane atoms are module singletons, so a dirty
// object would bleed across cases.
function makeContent(overrides: Partial<FileContent> = {}): FileContent {
  return {
    kind: "file",
    filename: "report.pdf",
    fileUrl: "https://blob.test/files/report.pdf",
    ...overrides,
  };
}

// FilePreviewer mounts SidepaneHeader, which reads useSidepane() — so every
// render needs a jotai store (mirrors the sibling previewer tests).
function renderPreviewer(content: FileContent): ReturnType<typeof render> {
  const ui: ReactElement = <FilePreviewer content={content} />;
  return render(<Provider store={createStore()}>{ui}</Provider>);
}

beforeEach(() => {
  // The markdown subtype fetches its file; a never-settling stub keeps it in its
  // loading state (body div present) without a real network round-trip.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("FilePreviewer", () => {
  it("renders the filename as the header title", () => {
    renderPreviewer(makeContent({ filename: "annual-report.pdf" }));
    expect(screen.getByText("annual-report.pdf")).toBeInTheDocument();
  });

  it("derives the header icon from the filename extension (xlsx → table)", () => {
    renderPreviewer(
      makeContent({
        filename: "sheet.xlsx",
        fileUrl: "https://blob.test/files/sheet.xlsx",
      }),
    );
    const headerIcon = screen.getByTestId("sidepane-header-icon");
    // xlsx maps to the tabler Table glyph (matches the attachment tile glyph),
    // not the generic file-description the header previously hardcoded.
    expect(headerIcon.querySelector(".tabler-icon-table")).toBeInTheDocument();
    expect(
      headerIcon.querySelector(".tabler-icon-file-description"),
    ).toBeNull();
  });

  describe("subtype dispatch", () => {
    it("renders the image body for an image url", () => {
      renderPreviewer(
        makeContent({
          fileUrl: "https://blob.test/p/cat.png",
          filename: "cat.png",
        }),
      );
      expect(screen.getByRole("img", { name: "cat.png" })).toHaveAttribute(
        "src",
        "https://blob.test/p/cat.png",
      );
    });

    it("renders the video body for a video url", () => {
      renderPreviewer(makeContent({ fileUrl: "https://blob.test/p/clip.mp4" }));
      expect(screen.getByTestId("file-video")).toHaveAttribute(
        "src",
        "https://blob.test/p/clip.mp4",
      );
    });

    it("dispatches an office url to the office viewer", () => {
      renderPreviewer(
        makeContent({ fileUrl: "https://blob.test/p/deck.pptx" }),
      );
      expect(screen.getByTestId("file-office")).toBeInTheDocument();
    });

    it("dispatches an html url to the sandboxed html viewer", () => {
      renderPreviewer(
        makeContent({ fileUrl: "https://blob.test/p/page.html" }),
      );
      // HtmlFileViewer delegates to SandboxedIframe, whose frame's accessible
      // name is the "File preview" title.
      expect(screen.getByTitle("File preview")).toBeInTheDocument();
    });

    it("dispatches a markdown url to the markdown file viewer", () => {
      renderPreviewer(makeContent({ fileUrl: "https://blob.test/p/notes.md" }));
      expect(screen.getByTestId("file-markdown")).toBeInTheDocument();
    });

    it("dispatches a txt url to the text file viewer", () => {
      renderPreviewer(
        makeContent({ fileUrl: "https://blob.test/p/notes.txt" }),
      );
      expect(screen.getByTestId("file-text")).toBeInTheDocument();
    });

    it("renders the download-fallback for csv (Office Online can't embed it)", () => {
      renderPreviewer(makeContent({ fileUrl: "https://blob.test/p/data.csv" }));
      expect(screen.getByRole("heading")).toHaveTextContent(
        "Preview not supported for this file type.",
      );
    });

    it("dispatches a pdf url to the lazy pdf viewer", () => {
      renderPreviewer(makeContent({ fileUrl: "https://blob.test/p/doc.pdf" }));
      expect(screen.getByTestId("lazy-pdf")).toBeInTheDocument();
    });

    it("dispatches a glb url to the lazy glb viewer", () => {
      renderPreviewer(
        makeContent({ fileUrl: "https://blob.test/p/model.glb" }),
      );
      expect(screen.getByTestId("lazy-glb")).toBeInTheDocument();
    });

    it("renders the download-fallback state for an unknown subtype", () => {
      renderPreviewer(makeContent({ fileUrl: "https://blob.test/p/data.xyz" }));
      expect(screen.getByRole("heading")).toHaveTextContent(
        "Preview not supported for this file type.",
      );
    });
  });

  describe("download action", () => {
    it("calls downloadFile with the url and filename from the header action", async () => {
      const user = userEvent.setup();
      renderPreviewer(makeContent());

      await user.click(screen.getByRole("button", { name: "Download" }));

      expect(downloadFile).toHaveBeenCalledWith(
        "https://blob.test/files/report.pdf",
        "report.pdf",
      );
    });

    it("wires the unsupported-state CTA to the same download", async () => {
      const user = userEvent.setup();
      renderPreviewer(
        makeContent({
          fileUrl: "https://blob.test/p/data.xyz",
          filename: "data.xyz",
        }),
      );

      // Two Download controls exist (header icon button + body CTA); both fire
      // the same handler, so clicking either calls downloadFile once.
      const downloads = screen.getAllByRole("button", { name: /Download/ });
      await user.click(downloads[downloads.length - 1]!);

      expect(downloadFile).toHaveBeenCalledWith(
        "https://blob.test/p/data.xyz",
        "data.xyz",
      );
    });
  });

  describe("add to project", () => {
    it("mounts the Add-to-project action for a deliverable file", () => {
      renderPreviewer(makeContent({ canAddToProject: true }));
      expect(screen.getByTestId("add-to-project")).toBeInTheDocument();
    });

    it("omits it for a plain file (a user attachment)", () => {
      renderPreviewer(makeContent());
      expect(screen.queryByTestId("add-to-project")).not.toBeInTheDocument();
    });
  });
});
