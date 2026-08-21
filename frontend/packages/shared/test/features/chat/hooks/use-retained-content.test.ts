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
