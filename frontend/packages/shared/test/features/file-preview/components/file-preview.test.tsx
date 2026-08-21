import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import { FilePreview } from "@/features/file-preview/components/file-preview";

// FilePreview is a pure dispatcher: it gates `fileUrl`, then picks a viewer by
// subtype. We stub every viewer with a testid probe so these tests assert ONLY
// the routing decision — the viewers' own rendering/IO is covered by their
// suites. Each probe echoes the `fileUrl` it received so we can prove the gate
// forwards the original url to the chosen viewer.
function Probe({
  testid,
  fileUrl,
}: {
  testid: string;
  fileUrl: string;
}): JSX.Element {
  return <div data-testid={testid} data-url={fileUrl} />;
}

vi.mock("@/features/file-preview/components/viewers/image-viewer", () => ({
  ImageViewer: ({ fileUrl }: { fileUrl: string }) => (
    <Probe testid="image-viewer" fileUrl={fileUrl} />
  ),
}));
vi.mock("@/features/file-preview/components/viewers/video-viewer", () => ({
  VideoViewer: ({ fileUrl }: { fileUrl: string }) => (
    <Probe testid="video-viewer" fileUrl={fileUrl} />
  ),
}));
vi.mock("@/features/file-preview/components/viewers/office-viewer", () => ({
  OfficeViewer: ({ fileUrl }: { fileUrl: string }) => (
    <Probe testid="office-viewer" fileUrl={fileUrl} />
  ),
}));
vi.mock("@/features/file-preview/components/viewers/lazy-pdf-viewer", () => ({
  LazyPdfViewer: ({ fileUrl }: { fileUrl: string }) => (
    <Probe testid="pdf-viewer" fileUrl={fileUrl} />
  ),
}));
vi.mock(
  "@/features/file-preview/components/viewers/markdown-file-viewer",
  () => ({
    MarkdownFileViewer: ({ fileUrl }: { fileUrl: string }) => (
      <Probe testid="markdown-viewer" fileUrl={fileUrl} />
    ),
  }),
);
vi.mock("@/features/file-preview/components/viewers/text-file-viewer", () => ({
  TextFileViewer: ({ fileUrl }: { fileUrl: string }) => (
    <Probe testid="text-viewer" fileUrl={fileUrl} />
  ),
}));
vi.mock("@/features/file-preview/components/viewers/html-file-viewer", () => ({
  HtmlFileViewer: ({ fileUrl }: { fileUrl: string }) => (
    <Probe testid="html-viewer" fileUrl={fileUrl} />
  ),
}));
vi.mock("@/features/file-preview/components/viewers/lazy-glb-viewer", () => ({
  LazyGlbViewer: ({ fileUrl }: { fileUrl: string }) => (
    <Probe testid="glb-viewer" fileUrl={fileUrl} />
  ),
}));
vi.mock(
  "@/features/file-preview/components/viewers/unsupported-viewer",
  () => ({
    UnsupportedViewer: ({ fileUrl }: { fileUrl: string }) => (
      <Probe testid="unsupported-viewer" fileUrl={fileUrl} />
    ),
  }),
);

describe("FilePreview routing", () => {
  it("routes a markdown SAS url to the markdown viewer", () => {
    render(
      <FilePreview
        fileUrl="https://blob/report.md?sv=x"
        filename="report.md"
      />,
    );
    expect(screen.getByTestId("markdown-viewer")).toHaveAttribute(
      "data-url",
      "https://blob/report.md?sv=x",
    );
  });

  it("routes a pdf SAS url to the pdf viewer", () => {
    render(<FilePreview fileUrl="https://blob/a.pdf?sv=x" filename="a.pdf" />);
    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute(
      "data-url",
      "https://blob/a.pdf?sv=x",
    );
  });

  it("routes an unknown extension to the unsupported viewer", () => {
    render(<FilePreview fileUrl="https://blob/a.bin?sv=x" filename="a.bin" />);
    expect(screen.getByTestId("unsupported-viewer")).toHaveAttribute(
      "data-url",
      "https://blob/a.bin?sv=x",
    );
  });
});

describe("FilePreview url gate", () => {
  // The agent-authored url fans out to fetch / <img> / <video> / pdfjs / Babylon
  // sinks; `fetch` defaults to same-origin credentials, so an unvalidated url is
  // a credentialed-GET surface. The gate must short-circuit BEFORE any viewer
  // (and its fetch) mounts.
  it("blocks a javascript: url before any content viewer mounts", () => {
    // eslint-disable-next-line no-script-url -- exercising the gate's reject path
    const blockedUrl = "javascript:alert(1)//x.md";
    render(<FilePreview fileUrl={blockedUrl} filename="x.md" />);
    expect(screen.getByTestId("unsupported-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-viewer")).not.toBeInTheDocument();
  });

  it("blocks a same-origin relative url carrying a query (side-effect GET)", () => {
    // The `.md` is on the PATH (so without the gate this routes to the markdown
    // viewer); the query is what `safeIconUri` rejects. This makes the
    // markdown-absent assertion discriminate gated-vs-routed — a path-less-ext
    // url like `/do?x=1.md` would parse to `unknown` and pass vacuously.
    render(<FilePreview fileUrl="/api/admin/do.md?x=1" filename="do.md" />);
    expect(screen.getByTestId("unsupported-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-viewer")).not.toBeInTheDocument();
  });

  it("forwards the original url to the unsupported fallback when blocked", () => {
    // eslint-disable-next-line no-script-url -- exercising the gate's reject path
    const blockedUrl = "javascript:alert(1)//x.md";
    render(<FilePreview fileUrl={blockedUrl} filename="x.md" />);
    expect(screen.getByTestId("unsupported-viewer")).toHaveAttribute(
      "data-url",
      blockedUrl,
    );
  });
});
