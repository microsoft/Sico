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
