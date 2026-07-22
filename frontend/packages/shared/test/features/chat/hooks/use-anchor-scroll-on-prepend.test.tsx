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
import { describe, expect, it } from "vitest";

import { useAnchorScrollOnPrepend } from "@/features/chat/hooks/use-anchor-scroll-on-prepend";

// jsdom never lays out, so scrollHeight is read-only 0. Back it with a closed-over
// value the getter reads, exposing `setHeight` to grow it (as a prepend would).
// `firstElementChild` must exist (the hook observes it), so give the container a
// child.
function makeContainer(): {
  container: HTMLDivElement;
  content: HTMLDivElement;
  setHeight: (value: number) => void;
} {
  const container = document.createElement("div");
  const content = document.createElement("div"); // content child to observe
  container.append(content);
  let height = 0;
  Object.defineProperty(container, "scrollHeight", {
    configurable: true,
    get: () => height,
  });
  return {
    container,
    content,
    setHeight: (value: number) => {
      height = value;
    },
  };
}

const refTo = (el: HTMLElement | null): { current: HTMLDivElement | null } => {
  const r = createRef<HTMLDivElement>();
  r.current = el as HTMLDivElement | null;
  return r;
};

describe("useAnchorScrollOnPrepend", () => {
  it("restores the captured distance-from-bottom after a prepend", () => {
    const { container, content, setHeight } = makeContainer();
    const ref = createRef<HTMLDivElement>();
    ref.current = container;

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useAnchorScrollOnPrepend(ref, refTo(content), id),
      { initialProps: { id: "newest" } },
    );

    // Reading mid-history: list 1000 tall, scrolled to 300 → 700px from bottom.
    setHeight(1000);
    container.scrollTop = 300;
    result.current(); // capture fromBottom = 1000 - 300 = 700

    // An older page prepends: 800px of content inserts above, list now 1800 tall,
    // and the oldest message id changes.
    setHeight(1800);
    rerender({ id: "older1" });

    // scrollTop restored to scrollHeight - fromBottom = 1800 - 700 = 1100 → the
    // reading position holds exactly (distance to bottom is back to 700).
    expect(container.scrollTop).toBe(1800 - 700);
  });

  it("does not adjust scrollTop when no capture is pending (bottom append / first mount)", () => {
    const { container, content, setHeight } = makeContainer();
    const ref = createRef<HTMLDivElement>();
    ref.current = container;

    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useAnchorScrollOnPrepend(ref, refTo(content), id),
      { initialProps: { id: "a" } },
    );

    setHeight(1000);
    container.scrollTop = 300;
    // A new turn appends at the bottom (id changes) but no capture() ran → the
    // hook must leave scrollTop alone, deferring to use-stick-to-bottom.
    setHeight(1100);
    rerender({ id: "b" });

    expect(container.scrollTop).toBe(300);
  });

  it("does not throw when the ref is null", () => {
    const ref = createRef<HTMLDivElement>();
    expect(() =>
      renderHook(
        ({ id }: { id: string }) =>
          useAnchorScrollOnPrepend(ref, refTo(null), id),
        {
          initialProps: { id: "x" },
        },
      ),
    ).not.toThrow();
  });
});
