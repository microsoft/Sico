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

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfficeViewer } from "@/features/file-preview/components/viewers/office-viewer";
import { logger } from "@/utils/logger";

const FILE_URL = "https://blob.test/files/deck.pptx";
// The MS Office Online embed endpoint the viewer frames; fileUrl rides in as the
// encoded `src` query param (the office doc is NEVER the iframe's own origin).
const EMBED_SRC = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(FILE_URL)}`;

describe("OfficeViewer", () => {
  it("frames the Microsoft Office Online embed with the encoded file url", () => {
    render(<OfficeViewer fileUrl={FILE_URL} />);
    expect(screen.getByTestId("file-office")).toHaveAttribute("src", EMBED_SRC);
  });

  it("names the frame so it has an accessible name", () => {
    render(<OfficeViewer fileUrl={FILE_URL} />);
    expect(screen.getByTitle("Office preview")).toBeInTheDocument();
  });

  it("does not sandbox the MS frame (a sandbox blanks Office Online)", () => {
    // The framed origin is the FIXED, trusted Microsoft Office Online service —
    // not the agent's url (which rides in only as an encoded query param). Any
    // `sandbox` attribute makes Office Online render blank (verified against the
    // live embed + legacy, which frames it un-sandboxed). Agent-authored HTML
    // still goes through the minimal SandboxedIframe; this trusted frame does not.
    render(<OfficeViewer fileUrl={FILE_URL} />);
    expect(screen.getByTestId("file-office").hasAttribute("sandbox")).toBe(
      false,
    );
  });

  it("shows a loading spinner before the frame loads", () => {
    render(<OfficeViewer fileUrl={FILE_URL} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("hides the spinner once the frame fires onLoad", () => {
    render(<OfficeViewer fileUrl={FILE_URL} />);
    // iframe load is not a user gesture, so fireEvent is the right tool here.
    fireEvent.load(screen.getByTestId("file-office"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("re-shows the spinner when the url changes after a load (MP13)", () => {
    // The SAME instance gets a new url (no key remount), exactly how the shell
    // replaces a file in place.
    const { rerender } = render(<OfficeViewer fileUrl={FILE_URL} />);
    fireEvent.load(screen.getByTestId("file-office"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<OfficeViewer fileUrl="https://blob.test/files/sheet.xlsx" />);
    // The replacement frame shows its own spinner, not the old loaded state.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("OfficeViewer load deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("falls back to the unpreviewable state when the frame never loads", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    render(<OfficeViewer fileUrl={FILE_URL} />);
    // A CSP/network-blocked frame fires neither load nor error; the 20s deadline
    // routes the dead frame to the shared download-fallback instead of spinning,
    // and logs the timeout so a chronic outage is observable.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(
      screen.getByText("Preview not supported for this file type."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
  });

  it("does not fall back when the frame loads before the deadline", () => {
    vi.useFakeTimers();
    render(<OfficeViewer fileUrl={FILE_URL} />);
    fireEvent.load(screen.getByTestId("file-office"));
    // onLoad clears the timer, so advancing past the deadline must not error.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(
      screen.queryByText("Preview not supported for this file type."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("file-office")).toBeInTheDocument();
  });
});
