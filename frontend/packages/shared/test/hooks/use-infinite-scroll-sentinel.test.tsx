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

import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useInfiniteScrollSentinel } from "@/hooks/use-infinite-scroll-sentinel";

// Controllable IntersectionObserver: capture the instance so the test can drive
// `isIntersecting` on demand (jsdom has no real layout / IO).
type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let ioInstances: {
  callback: IOCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}[];

function fireIntersect(isIntersecting: boolean): void {
  ioInstances.at(-1)?.callback([
    {
      isIntersecting,
    } as Partial<IntersectionObserverEntry> as IntersectionObserverEntry,
  ]);
}

beforeEach(() => {
  ioInstances = [];
  class MockIO {
    callback: IOCallback;
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "";
    thresholds = [];
    constructor(cb: IOCallback) {
      this.callback = cb;
      ioInstances.push({
        callback: cb,
        observe: this.observe,
        disconnect: this.disconnect,
      });
    }
  }
  Object.defineProperty(global, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: MockIO,
  });
});

function makeSentinel(): {
  ref: ReturnType<typeof createRef<HTMLDivElement>>;
} {
  const ref = createRef<HTMLDivElement>();
  ref.current = document.createElement("div");
  return { ref };
}

describe("useInfiniteScrollSentinel", () => {
  it("fetches once when the sentinel scrolls into view", () => {
    const { ref } = makeSentinel();
    const fetchNextPage = vi.fn();
    renderHook(() =>
      useInfiniteScrollSentinel(ref, {
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
      }),
    );

    fireIntersect(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("pokes a fetch when hasNextPage flips false→true while already intersecting (cold load)", () => {
    const { ref } = makeSentinel();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHook(
      ({ hasNextPage }: { hasNextPage: boolean }) =>
        useInfiniteScrollSentinel(ref, {
          hasNextPage,
          isFetchingNextPage: false,
          fetchNextPage,
        }),
      { initialProps: { hasNextPage: false } },
    );

    // Sentinel is already inside the rootMargin (cold load: list shorter than
    // the viewport). IO fired once with the first (empty) page; hasNextPage was
    // false, so nothing fetched.
    fireIntersect(true);
    expect(fetchNextPage).not.toHaveBeenCalled();

    // First page resolves and flips hasNextPage on. IO won't re-fire (no
    // transition), so the hook must poke the fetch itself.
    rerender({ hasNextPage: true });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-fetch when a fetch completes while still intersecting (no avalanche)", () => {
    const { ref } = makeSentinel();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHook(
      ({ isFetchingNextPage }: { isFetchingNextPage: boolean }) =>
        useInfiniteScrollSentinel(ref, {
          hasNextPage: true,
          isFetchingNextPage,
          fetchNextPage,
        }),
      { initialProps: { isFetchingNextPage: false } },
    );

    // Sentinel intersects and triggers the first fetch.
    fireIntersect(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    // The fetch is in flight…
    rerender({ isFetchingNextPage: true });
    // …and completes. The sentinel is STILL intersecting (at scrollTop 0 the
    // sentinel never leaves the 200px band, and native scroll-anchoring holds
    // position so it isn't pushed out). By default the hook must NOT auto-fetch
    // the next page off this completion — only a real new intersection or a
    // hasNextPage rising edge should. Otherwise it drains every page in one
    // burst (reverse pagination, e.g. chat history).
    rerender({ isFetchingNextPage: false });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("with fillOnComplete, keeps fetching across completions while still intersecting (fill the container)", () => {
    const { ref } = makeSentinel();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHook(
      ({ isFetchingNextPage }: { isFetchingNextPage: boolean }) =>
        useInfiniteScrollSentinel(
          ref,
          {
            hasNextPage: true,
            isFetchingNextPage,
            fetchNextPage,
          },
          { fillOnComplete: true },
        ),
      { initialProps: { isFetchingNextPage: false } },
    );

    // First fetch on intersect.
    fireIntersect(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    // The page resolves but is still shorter than the container, so the sentinel
    // never leaves the band (IO stays intersecting, no false callback). With
    // fillOnComplete the hook pokes another fetch to keep filling — otherwise
    // pagination stalls one page in with empty space below (forward-paginated
    // sidebar list).
    rerender({ isFetchingNextPage: true });
    rerender({ isFetchingNextPage: false });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("with fillOnComplete, stops once the sentinel leaves view (container filled)", () => {
    const { ref } = makeSentinel();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHook(
      ({ isFetchingNextPage }: { isFetchingNextPage: boolean }) =>
        useInfiniteScrollSentinel(
          ref,
          {
            hasNextPage: true,
            isFetchingNextPage,
            fetchNextPage,
          },
          { fillOnComplete: true },
        ),
      { initialProps: { isFetchingNextPage: false } },
    );

    fireIntersect(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    // The new page filled the container and pushed the sentinel out of view.
    rerender({ isFetchingNextPage: true });
    fireIntersect(false);
    rerender({ isFetchingNextPage: false });
    // No more auto-fetch: the container is full, the user must scroll again.
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("with fillOnComplete, stops when hasNextPage is false even while intersecting", () => {
    const { ref } = makeSentinel();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHook(
      ({
        hasNextPage,
        isFetchingNextPage,
      }: {
        hasNextPage: boolean;
        isFetchingNextPage: boolean;
      }) =>
        useInfiniteScrollSentinel(
          ref,
          { hasNextPage, isFetchingNextPage, fetchNextPage },
          { fillOnComplete: true },
        ),
      { initialProps: { hasNextPage: true, isFetchingNextPage: false } },
    );

    fireIntersect(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    // Last page resolved: hasNextPage flips false. Even intersecting + fill mode,
    // there's nothing left to fetch.
    rerender({ hasNextPage: true, isFetchingNextPage: true });
    rerender({ hasNextPage: false, isFetchingNextPage: false });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("with fillOnComplete, caps runaway auto-pokes when the list never grows (empty-page safety valve)", () => {
    const { ref } = makeSentinel();
    const fetchNextPage = vi.fn();
    const { rerender } = renderHook(
      ({ isFetchingNextPage }: { isFetchingNextPage: boolean }) =>
        useInfiniteScrollSentinel(
          ref,
          { hasNextPage: true, isFetchingNextPage, fetchNextPage },
          { fillOnComplete: true },
        ),
      { initialProps: { isFetchingNextPage: false } },
    );

    // Pathological backend: every page resolves `hasNext:true` with no rows, so
    // the list never grows, the sentinel never leaves the band, and fill-on-
    // complete would poke forever. Drive many complete→settle cycles.
    fireIntersect(true);
    for (let i = 0; i < 50; i += 1) {
      rerender({ isFetchingNextPage: true });
      rerender({ isFetchingNextPage: false });
    }
    // The safety valve must have stopped the loop well before 50 pokes.
    expect(fetchNextPage.mock.calls.length).toBeLessThan(50);
  });
});
