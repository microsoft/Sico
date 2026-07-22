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

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SandboxedIframe } from "@/features/file-preview/components/sandboxed-iframe";

// Verbatim blocked copy — asserted in both the bad-scheme and onError cases, so
// a single const keeps the two assertions in lockstep with the component.
const BLOCKED_COPY =
  "This page can't be shown here. Open it in a new tab to view it.";

// SandboxedIframe owns no atoms/useSidepane (the caller mounts the header), so —
// unlike the previewer — it renders bare, with no jotai Provider.
function renderFrame(url: string): ReturnType<typeof render> {
  return render(
    <SandboxedIframe
      url={url}
      title="Preview Page"
      blockedCopy={BLOCKED_COPY}
    />,
  );
}

describe("SandboxedIframe", () => {
  it("renders the blocked copy for a non-https scheme (MI5)", () => {
    renderFrame("http://x");
    expect(screen.getByText(BLOCKED_COPY)).toBeInTheDocument();
  });

  it("never mounts an iframe for a non-https scheme (MI5)", () => {
    renderFrame("http://x");
    // The iframe's accessible name is its `title` — absent means no frame.
    expect(screen.queryByTitle("Preview Page")).not.toBeInTheDocument();
  });

  it("mounts an iframe for an https url", () => {
    renderFrame("https://example.com/p");
    expect(screen.getByTitle("Preview Page")).toBeInTheDocument();
  });

  it("points the iframe src at the guarded https url", () => {
    renderFrame("https://example.com/p");
    expect(screen.getByTitle("Preview Page")).toHaveAttribute(
      "src",
      "https://example.com/p",
    );
  });

  it("sandboxes the iframe to exactly allow-scripts, never allow-same-origin (MI4/OQ5)", () => {
    renderFrame("https://example.com/p");
    // Exact equality is the security assertion: any extra token — above all
    // allow-same-origin — would let the framed page escape its own sandbox.
    expect(screen.getByTitle("Preview Page").getAttribute("sandbox")).toBe(
      "allow-scripts",
    );
  });

  it("shows a loading spinner before the frame loads (MI16)", () => {
    renderFrame("https://example.com/p");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("hides the spinner once the frame fires onLoad (MI16)", () => {
    renderFrame("https://example.com/p");
    // iframe load is not a user gesture, so fireEvent is the right tool here.
    fireEvent.load(screen.getByTitle("Preview Page"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the blocked state when the frame errors (MI17)", () => {
    renderFrame("https://example.com/p");
    fireEvent.error(screen.getByTitle("Preview Page"));
    expect(screen.getByText(BLOCKED_COPY)).toBeInTheDocument();
  });

  it("re-shows the spinner when the url changes after a load (MP13)", () => {
    // The SAME instance gets a new url (no key remount), exactly how the shell
    // replaces a webpage in place.
    const { rerender } = render(
      <SandboxedIframe
        url="https://a.example/"
        title="Preview Page"
        blockedCopy={BLOCKED_COPY}
      />,
    );
    fireEvent.load(screen.getByTitle("Preview Page"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(
      <SandboxedIframe
        url="https://b.example/"
        title="Preview Page"
        blockedCopy={BLOCKED_COPY}
      />,
    );
    // The replacement frame shows its own spinner, not the old loaded state.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("mounts the iframe when an errored url is replaced by a valid one (MP13)", () => {
    const { rerender } = render(
      <SandboxedIframe
        url="https://a.example/"
        title="Preview Page"
        blockedCopy={BLOCKED_COPY}
      />,
    );
    fireEvent.error(screen.getByTitle("Preview Page"));
    expect(screen.getByText(BLOCKED_COPY)).toBeInTheDocument();

    rerender(
      <SandboxedIframe
        url="https://b.example/"
        title="Preview Page"
        blockedCopy={BLOCKED_COPY}
      />,
    );
    // A stale `errored` from the previous url must not pin the new valid one on
    // the blocked state — the frame mounts and the blocked copy clears.
    expect(screen.getByTitle("Preview Page")).toBeInTheDocument();
    expect(screen.queryByText(BLOCKED_COPY)).not.toBeInTheDocument();
  });
});
