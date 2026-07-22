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

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SidepaneContent } from "@/features/chat/atoms/sidepane-atom";
import { useRetainedContent } from "@/features/chat/hooks/use-retained-content";

const MARKDOWN: SidepaneContent = {
  kind: "markdown",
  title: "A",
  markdown: "# a",
};
const FILE: SidepaneContent = {
  kind: "file",
  filename: "x.txt",
  fileUrl: "https://x/x.txt",
};

// The slide-out timer is 320ms; advance past it to reach the dropped state.
const PAST_SLIDE_OUT = 400;

// Explicit Props=SidepaneContent so `rerender(null)` / `rerender(FILE)` typecheck
// (bare inference narrows Props to the first item's variant).
function renderRetained(
  initial: SidepaneContent,
): ReturnType<typeof renderHook<SidepaneContent, SidepaneContent>> {
  return renderHook<SidepaneContent, SidepaneContent>(
    (content) => useRetainedContent(content),
    { initialProps: initial },
  );
}

describe("useRetainedContent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the live content while open", () => {
    const { result } = renderRetained(MARKDOWN);

    expect(result.current).toEqual(MARKDOWN);
  });

  it("retains the prior content immediately after content goes null (slide-out)", () => {
    const { result, rerender } = renderRetained(MARKDOWN);

    rerender(null);

    // The previewer must linger for the close transition, not blank instantly.
    expect(result.current).toEqual(MARKDOWN);
  });

  it("drops the retained content after the slide-out elapses", () => {
    const { result, rerender } = renderRetained(MARKDOWN);
    rerender(null);

    act(() => {
      vi.advanceTimersByTime(PAST_SLIDE_OUT);
    });

    expect(result.current).toBeNull();
  });

  it("adopts a new open target synchronously (no empty frame on swap)", () => {
    const { result, rerender } = renderRetained(MARKDOWN);

    rerender(FILE);

    expect(result.current).toEqual(FILE);
  });

  it("re-opening before the slide-out elapses cancels the drop", () => {
    const { result, rerender } = renderRetained(MARKDOWN);
    rerender(null);
    rerender(FILE);

    // The pending drop timer must be cleared, so the new content survives.
    act(() => {
      vi.advanceTimersByTime(PAST_SLIDE_OUT);
    });

    expect(result.current).toEqual(FILE);
  });
});
