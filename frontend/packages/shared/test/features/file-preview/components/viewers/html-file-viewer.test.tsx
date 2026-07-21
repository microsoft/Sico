import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HtmlFileViewer } from "@/features/file-preview/components/viewers/html-file-viewer";

// The blocked copy the viewer hands to SandboxedIframe — asserting it appears
// proves the prop is wired through (the frame mechanics themselves are covered
// in sandboxed-iframe.test.tsx).
const BLOCKED_COPY =
  "This file can't be shown here. Download it to view its contents.";

// These tests cover only what HtmlFileViewer ADDS on top of SandboxedIframe:
// threading fileUrl / title / blockedCopy into the delegated body. The sandbox
// attribute, spinner toggle and https-gate all live in sandboxed-iframe.test.tsx.
describe("HtmlFileViewer", () => {
  it("frames the file url for a valid https url", () => {
    render(<HtmlFileViewer fileUrl="https://blob.test/p/page.html" />);
    expect(screen.getByTitle("File preview")).toHaveAttribute(
      "src",
      "https://blob.test/p/page.html",
    );
  });

  it("shows the blocked copy for a non-https url", () => {
    // An html file served over a non-https url is gated by SandboxedIframe's
    // https-only posture — the viewer's blockedCopy is what surfaces.
    render(<HtmlFileViewer fileUrl="http://blob.test/p/page.html" />);
    expect(screen.getByText(BLOCKED_COPY)).toBeInTheDocument();
  });
});
