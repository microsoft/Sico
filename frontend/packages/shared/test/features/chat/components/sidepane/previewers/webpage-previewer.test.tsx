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
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import type { SidepaneContent } from "@/features/chat/atoms/sidepane-atom";
import { WebpagePreviewer } from "@/features/chat/components/sidepane/previewers/webpage-previewer";

type WebpageContent = Extract<SidepaneContent, { kind: "webpage" }>;

// The blocked copy the previewer hands to SandboxedIframe as `blockedCopy` —
// asserting it appears proves that prop is wired through (the frame mechanics
// themselves are covered in sandboxed-iframe.test.tsx).
const BLOCKED_COPY =
  "This page can't be shown here. Open it in a new tab to view it.";

// Fresh fixture per test — the sidepane atoms are module singletons, so a dirty
// object would bleed across cases.
function makeContent(overrides: Partial<WebpageContent> = {}): WebpageContent {
  return { kind: "webpage", url: "https://example.com/p", ...overrides };
}

// WebpagePreviewer mounts SidepaneHeader, which reads useSidepane() — so every
// render needs a jotai store (mirrors the SidepaneHeader/Markdown test setup).
function renderPreviewer(content: WebpageContent): ReturnType<typeof render> {
  const ui: ReactElement = <WebpagePreviewer content={content} />;
  return render(<Provider store={createStore()}>{ui}</Provider>);
}

// These tests cover only what the previewer ADDS on top of SandboxedIframe:
// mounting the header and threading content.url / title / blockedCopy into the
// delegated body. The sandbox attribute, spinner toggle, native error handling
// and MP13 replace-in-place all live in sandboxed-iframe.test.tsx — re-testing
// them here would just duplicate the unit that owns them.
//
// "Preview Page" appears twice for a valid url: the header renders it as TEXT
// (a <p>), the frame carries it as a `title` ATTRIBUTE. getByText matches text
// content only and getByTitle matches the attribute only, so each query
// resolves exactly one of the two nodes — the basis for asserting header + frame
// independently below.
describe("WebpagePreviewer", () => {
  it("mounts the header and frames the body for a valid https url", () => {
    renderPreviewer(makeContent({ url: "https://example.com/p" }));
    // Header (text) and delegated frame (title attr) both mount — the previewer
    // composes SidepaneHeader + SandboxedIframe.
    expect(screen.getByText("Preview Page")).toBeInTheDocument();
    expect(screen.getByTitle("Preview Page")).toBeInTheDocument();
  });

  it("threads content.url into the framed body's src", () => {
    renderPreviewer(makeContent({ url: "https://example.com/p" }));
    // Proves the url is passed through, not hardcoded — the frame's src is the
    // content's url (https-guarded by SandboxedIframe).
    expect(screen.getByTitle("Preview Page")).toHaveAttribute(
      "src",
      "https://example.com/p",
    );
  });

  it("mounts the header alongside the blocked body for a non-https url", () => {
    renderPreviewer(makeContent({ url: "http://x" }));
    // The blocked copy comes from the previewer's `blockedCopy` prop, and the
    // header still mounts regardless of the body's blocked/framed state.
    expect(screen.getByText(BLOCKED_COPY)).toBeInTheDocument();
    expect(screen.getByText("Preview Page")).toBeInTheDocument();
  });
});
