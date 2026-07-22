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

import { buildSidepaneContent } from "@/features/chat/utils/build-sidepane-content";
import { type RenderableDeliverable } from "@/features/chat/utils/deliverable";

// The card→content mapping (design decision S3): one parsed deliverable becomes
// one SidepaneContent. These cover all three deliverable kinds plus the two
// missing-content fallbacks (`?? ""`). `kind` can never be "sandbox" (that comes
// from the header Device button), so there is no real value to exercise the
// `default: null` branch — TypeScript makes it unreachable.

describe("buildSidepaneContent", () => {
  it("maps a markdown deliverable to title + markdown body", () => {
    const deliverable: RenderableDeliverable = {
      id: "0",
      label: "Title",
      isPreview: false,
      kind: "markdown",
      markdown: "# Body",
    };
    expect(buildSidepaneContent(deliverable)).toEqual({
      kind: "markdown",
      title: "Title",
      markdown: "# Body",
    });
  });

  it("falls back to an empty markdown body when the deliverable has none", () => {
    const deliverable: RenderableDeliverable = {
      id: "0",
      label: "Title",
      isPreview: false,
      kind: "markdown",
    };
    expect(buildSidepaneContent(deliverable)).toEqual({
      kind: "markdown",
      title: "Title",
      markdown: "",
    });
  });

  it("maps a webpage deliverable to its url", () => {
    const deliverable: RenderableDeliverable = {
      id: "0",
      label: "Preview Page",
      isPreview: true,
      kind: "webpage",
      url: "https://x/p",
    };
    expect(buildSidepaneContent(deliverable)).toEqual({
      kind: "webpage",
      url: "https://x/p",
    });
  });

  it("falls back to an empty url when the webpage deliverable has none", () => {
    const deliverable: RenderableDeliverable = {
      id: "0",
      label: "Preview Page",
      isPreview: true,
      kind: "webpage",
    };
    expect(buildSidepaneContent(deliverable)).toEqual({
      kind: "webpage",
      url: "",
    });
  });

  it("maps a file deliverable's label to the content filename and surfaces its url", () => {
    const deliverable: RenderableDeliverable = {
      id: "0",
      label: "report.pdf",
      isPreview: false,
      kind: "file",
      fileUrl: "https://x/report.pdf",
      fileUri: "default_space/0/report.pdf",
    };
    expect(buildSidepaneContent(deliverable)).toEqual({
      kind: "file",
      filename: "report.pdf",
      fileUrl: "https://x/report.pdf",
      fileUri: "default_space/0/report.pdf",
      // A deliverable file can be published to the project (≠ a user attachment).
      canAddToProject: true,
    });
  });

  it("falls back to an empty url when the file deliverable has none", () => {
    const deliverable: RenderableDeliverable = {
      id: "0",
      label: "report.pdf",
      isPreview: false,
      kind: "file",
    };
    expect(buildSidepaneContent(deliverable)).toEqual({
      kind: "file",
      filename: "report.pdf",
      fileUrl: "",
      fileUri: "",
      canAddToProject: true,
    });
  });
});
