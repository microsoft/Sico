import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSmoothText } from "@/features/chat/hooks/use-smooth-text";

// The animator is rAF + Date.now driven; fake timers let us advance it
// deterministically. setup.ts backs rAF with setTimeout(0), so advancing timers
// runs the frames; we also advance the mocked clock so the per-char budget
// accrues.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// Run N animation frames, advancing the clock `ms` before each so the animator
// accrues a time budget to reveal characters.
function advance(frames: number, ms = 20): void {
  for (let i = 0; i < frames; i++) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }
}

describe("useSmoothText", () => {
  it("returns the full text immediately when not streaming", () => {
    const { result } = renderHook(() => useSmoothText("hello world", false));
    expect(result.current).toBe("hello world");
  });

  it("starts empty then reveals progressively while streaming", () => {
    const { result } = renderHook(() => useSmoothText("hello", true));
    // Before any frame, nothing is revealed.
    expect(result.current).toBe("");
    advance(2);
    // Some — but not necessarily all — characters have appeared.
    expect(result.current.length).toBeGreaterThan(0);
    expect("hello".startsWith(result.current)).toBe(true);
  });

  it("eventually catches up to the full text", () => {
    const { result } = renderHook(() => useSmoothText("hello world", true));
    advance(50);
    expect(result.current).toBe("hello world");
  });

  it("reveals appended text as the target grows (continuation)", () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: string }) => useSmoothText(t, true),
      { initialProps: { t: "hello" } },
    );
    advance(50);
    expect(result.current).toBe("hello");

    rerender({ t: "hello world" });
    advance(50);
    expect(result.current).toBe("hello world");
  });

  it("resyncs instantly when the text is no longer a continuation", () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: string }) => useSmoothText(t, true),
      { initialProps: { t: "first answer" } },
    );
    advance(50);
    expect(result.current).toBe("first answer");

    // A different message replaces it — not a prefix continuation.
    rerender({ t: "totally different" });
    advance(50);
    expect(result.current).toBe("totally different");
  });

  it("shows the full text immediately when streaming ends", () => {
    const { result, rerender } = renderHook(
      ({ t, s }: { t: string; s: boolean }) => useSmoothText(t, s),
      { initialProps: { t: "a long streamed reply", s: true } },
    );
    // Mid-stream, only part is shown.
    advance(1);
    expect(result.current.length).toBeLessThan("a long streamed reply".length);

    // Stream ends → full text, no waiting for the animation.
    rerender({ t: "a long streamed reply", s: false });
    expect(result.current).toBe("a long streamed reply");
  });

  it("shows full text immediately under prefers-reduced-motion", () => {
    // matchMedia normally reports no-match (setup.ts) → smoothing on. Force the
    // reduce-motion match: the hook must skip the animation entirely.
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const { result } = renderHook(() => useSmoothText("instant body", true));
      expect(result.current).toBe("instant body");
    } finally {
      window.matchMedia = original;
    }
  });
});
