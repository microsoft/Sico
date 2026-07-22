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
import { describe, expect, it, vi } from "vitest";

import { useScrollNewHumanToTop } from "@/features/chat/hooks/use-scroll-new-human-to-top";

// jsdom never lays out: scrollHeight/clientHeight are read-only 0 and
// getBoundingClientRect returns all-zero. Back them with closed-over values so
// the hook's geometry runs. The anchor's position within the scroll container
// is read via rect-delta + scrollTop (the hook does NOT use offsetParent, which
// jsdom can't model and which skips a static scroll container in a real
// browser). We model that: the container's rect top is fixed at 0, the anchor's
// rect top is `anchorTop - scrollTop`, so `anchorRectTop - containerRectTop +
// scrollTop === anchorTop` regardless of the current scroll offset.
//
// The hook measures the CONTENT element's scrollHeight (not the container's,
// which the browser clamps to clientHeight on underflow), so we back
// `content.scrollHeight` = `contentBase`, and the sibling spacer's `offsetHeight`
// reflects the minHeight the hook writes. `contentBase` is the natural content
// height; grow it to model a streaming reply.
function makeHarness(opts: {
  contentBase: number;
  clientHeight: number;
  anchorTop: number;
  anchorHeight: number;
  anchorId: string;
}): {
  container: HTMLDivElement;
  content: HTMLDivElement;
  spacer: HTMLDivElement;
  setContentBase: (value: number) => void;
} {
  const container = document.createElement("div");
  const content = document.createElement("div");
  const anchor = document.createElement("div");
  anchor.setAttribute("data-message-id", opts.anchorId);
  const spacer = document.createElement("div");
  content.append(anchor);
  // Spacer is a SIBLING of content (not inside it), matching the real DOM: the
  // library observes content, so the filler lives outside it. `content.scrollHeight`
  // is therefore the base height; the container's reflects base + filler.
  container.append(content, spacer);

  let scrollTop = 0;
  let contentBase = opts.contentBase;
  const spacerHeight = (): number => parseFloat(spacer.style.minHeight) || 0;

  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    get: () => opts.clientHeight,
  });
  Object.defineProperty(content, "scrollHeight", {
    configurable: true,
    get: () => contentBase,
  });
  container.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  // Anchor sits `anchorTop` into the content; on screen its rect top is that
  // minus however far we've scrolled.
  anchor.getBoundingClientRect = () =>
    ({ top: opts.anchorTop - scrollTop }) as DOMRect;
  Object.defineProperty(anchor, "offsetHeight", {
    configurable: true,
    get: () => opts.anchorHeight,
  });
  Object.defineProperty(spacer, "offsetHeight", {
    configurable: true,
    get: spacerHeight,
  });

  return {
    container,
    content,
    spacer,
    setContentBase: (value: number) => {
      contentBase = value;
    },
  };
}

const scrollRefOf = (el: HTMLElement): { current: HTMLElement | null } => {
  const ref = createRef<HTMLElement>();
  ref.current = el;
  return ref;
};

describe("useScrollNewHumanToTop", () => {
  it("pins a newly-sent message near the top of the viewport", () => {
    const { container, content, spacer } = makeHarness({
      contentBase: 2000,
      clientHeight: 600,
      anchorTop: 1500,
      anchorHeight: 60,
      anchorId: "h2",
    });
    const stopScroll = vi.fn();

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          {
            stopScroll,
            enabled: true,
          },
        ),
      { initialProps: { id: "h1" } },
    );

    // A fresh human id appears (a send).
    rerender({ id: "h2" });

    // Short message (< threshold) → target = anchorTop - 16.
    expect(container.scrollTop).toBe(1500 - 16);
  });

  it("over-scrolls a tall question so only the reply-room fraction stays", () => {
    // anchorHeight 900 > threshold (600*0.65=390): the hook over-scrolls past the
    // anchor top, leaving ~visibleHeight on screen so the reply gets room.
    const { container, content, spacer } = makeHarness({
      contentBase: 3000,
      clientHeight: 600,
      anchorTop: 500,
      anchorHeight: 900,
      anchorId: "h2",
    });
    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          { stopScroll: vi.fn(), enabled: true },
        ),
      { initialProps: { id: "h1" } },
    );
    rerender({ id: "h2" });
    // 500 - 16 + (900 - 390) = 994 → scrolled well past the anchor's own top.
    expect(container.scrollTop).toBe(994);
  });

  it("measures the anchor by rect delta, not offsetParent (static scroll container)", () => {
    // Regression guard for the off-by-a-lot over-scroll: the real scroll
    // container is `position: static`, so the anchor's `offsetParent` is the
    // outer positioned wrapper, NOT the scroller. An offsetTop walk keyed on the
    // scroller would never reach it and over-measure. Here the anchor's
    // offsetParent is deliberately a DETACHED node (≠ container), yet the pin
    // must still land at anchorTop-16 because the hook uses rect delta.
    const { container, content, spacer } = makeHarness({
      contentBase: 3000,
      clientHeight: 600,
      anchorTop: 1800,
      anchorHeight: 60,
      anchorId: "h2",
    });
    const anchor = container.querySelector<HTMLElement>(
      '[data-message-id="h2"]',
    )!;
    Object.defineProperty(anchor, "offsetParent", {
      configurable: true,
      get: () => document.createElement("section"), // anything that is NOT the scroller
    });

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          {
            stopScroll: vi.fn(),
            enabled: true,
          },
        ),
      { initialProps: { id: "h1" } },
    );
    rerender({ id: "h2" });

    expect(container.scrollTop).toBe(1800 - 16);
  });

  it("escapes the bottom lock BEFORE moving the scroll", () => {
    const { container, content, spacer } = makeHarness({
      contentBase: 2000,
      clientHeight: 600,
      anchorTop: 1500,
      anchorHeight: 60,
      anchorId: "h2",
    });
    const order: string[] = [];
    const stopScroll = vi.fn(() => order.push("stop"));
    // scrollTop setter records its call order relative to stopScroll.
    let scrollTop = 0;
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
        order.push("scroll");
      },
    });

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          {
            stopScroll,
            enabled: true,
          },
        ),
      { initialProps: { id: "h1" } },
    );
    rerender({ id: "h2" });

    expect(order).toEqual(["stop", "scroll"]);
  });

  it("reserves filler below so the target is reachable", () => {
    const { container, content, spacer } = makeHarness({
      contentBase: 1600,
      clientHeight: 600,
      anchorTop: 1500,
      anchorHeight: 60,
      anchorId: "h2",
    });

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          {
            stopScroll: vi.fn(),
            enabled: true,
          },
        ),
      { initialProps: { id: "h1" } },
    );
    rerender({ id: "h2" });

    // target = 1500-16 = 1484; need 1484+600+96 = 2180 of content; have 1600
    // (reserveHeight 0) → reserve 556px (incl. cushion), as a min-height.
    expect(spacer.style.minHeight).toBe("556px");
  });

  it("stays pinned (never re-scrolls) as the reply fills the gap (reserve → 0)", () => {
    // Capture the ResizeObserver callback so we can simulate the reply growing.
    let observerCb: (() => void) | undefined;
    const realRO = global.ResizeObserver;
    class CapturingRO {
      constructor(cb: () => void) {
        observerCb = cb;
      }

      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    global.ResizeObserver = CapturingRO as unknown as typeof ResizeObserver;

    const { container, content, spacer, setContentBase } = makeHarness({
      contentBase: 1600, // not yet tall enough → reserve > 0 at pin
      clientHeight: 600,
      anchorTop: 1500,
      anchorHeight: 60,
      anchorId: "h2",
    });

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          {
            stopScroll: vi.fn(),
            enabled: true,
          },
        ),
      { initialProps: { id: "h1" } },
    );
    rerender({ id: "h2" });

    const pinnedAt = container.scrollTop; // 1484 (anchorTop − 16)

    // Reply streams in until it fills the gap: reserve computes to 0, the filler
    // collapses — but the scroll position must NOT move (the question stays put;
    // following is the user's choice via a manual scroll-down, handled natively
    // by use-stick-to-bottom).
    setContentBase(3000);
    observerCb?.();

    expect(spacer.style.minHeight).toBe("0px");
    expect(container.scrollTop).toBe(pinnedAt);

    global.ResizeObserver = realRO;
  });

  it("does not scroll on the first commit (adopting existing history)", () => {
    const { container, content, spacer } = makeHarness({
      contentBase: 2000,
      clientHeight: 600,
      anchorTop: 1500,
      anchorHeight: 60,
      anchorId: "h1",
    });
    const stopScroll = vi.fn();

    renderHook(() =>
      useScrollNewHumanToTop(
        {
          scroll: scrollRefOf(container),
          content: scrollRefOf(content),
          spacer: scrollRefOf(spacer),
        },
        "h1",
        {
          stopScroll,
          enabled: true,
        },
      ),
    );

    expect(stopScroll).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(0);
  });

  it("does not scroll when the id is unchanged (streaming frame)", () => {
    const { container, content, spacer } = makeHarness({
      contentBase: 2000,
      clientHeight: 600,
      anchorTop: 1500,
      anchorHeight: 60,
      anchorId: "h2",
    });
    const stopScroll = vi.fn();

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          {
            stopScroll,
            enabled: true,
          },
        ),
      { initialProps: { id: "h2" } },
    );
    // Same id, new render (a streaming frame grew the reply).
    rerender({ id: "h2" });

    expect(stopScroll).not.toHaveBeenCalled();
  });

  it("skips when the anchor is already at the top (nothing to lift)", () => {
    // The first message in a thread sits at the very top: target computes to
    // <= 0, so there's nothing to pin and no filler to manufacture.
    const { container, content, spacer } = makeHarness({
      contentBase: 400,
      clientHeight: 600,
      anchorTop: 0,
      anchorHeight: 60,
      anchorId: "h2",
    });
    const stopScroll = vi.fn();

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          {
            stopScroll,
            enabled: true,
          },
        ),
      { initialProps: { id: "h1" } },
    );
    rerender({ id: "h2" });

    expect(stopScroll).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(0);
    expect(spacer.style.minHeight).toBe("");
  });

  it("does nothing while disabled (first-load hidden phase)", () => {
    const { container, content, spacer } = makeHarness({
      contentBase: 2000,
      clientHeight: 600,
      anchorTop: 1500,
      anchorHeight: 60,
      anchorId: "h2",
    });
    const stopScroll = vi.fn();

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useScrollNewHumanToTop(
          {
            scroll: scrollRefOf(container),
            content: scrollRefOf(content),
            spacer: scrollRefOf(spacer),
          },
          id,
          {
            stopScroll,
            enabled: false,
          },
        ),
      { initialProps: { id: "h1" } },
    );
    rerender({ id: "h2" });

    expect(stopScroll).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(0);
  });
});
