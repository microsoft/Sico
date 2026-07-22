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
import { afterEach, describe, expect, it } from "vitest";

import { useTableScrollEdges } from "@/features/projects/hooks/use-table-scroll-edges";

// Build the DOM shape the hook walks: a `group/table` wrapper containing the
// @sico/ui scroll node (`data-slot="table-container"`) which itself wraps the
// inner `<table data-slot="table">`. Scroll geometry is not laid out in jsdom,
// so we define the read-only metrics ourselves.
function makeTable(metrics: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): { wrapper: HTMLDivElement; scroller: HTMLDivElement } {
  const wrapper = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.dataset.slot = "table-container";
  const table = document.createElement("table");
  table.dataset.slot = "table";
  scroller.append(table);
  wrapper.append(scroller);
  document.body.append(wrapper);
  Object.defineProperties(scroller, {
    clientWidth: { value: metrics.clientWidth, configurable: true },
    scrollWidth: { value: metrics.scrollWidth, configurable: true },
  });
  scroller.scrollLeft = metrics.scrollLeft;
  return { wrapper, scroller };
}

// The hook returns a callback ref; attach it to the wrapper and return the
// wrapper so tests can read its `data-scroll-*` and the ref to detach.
function attach(metrics: Parameters<typeof makeTable>[0]): {
  wrapper: HTMLDivElement;
  scroller: HTMLDivElement;
  setRef: (node: HTMLElement | null) => void;
} {
  const { wrapper, scroller } = makeTable(metrics);
  const { result } = renderHook(() => useTableScrollEdges());
  const setRef = result.current;
  setRef(wrapper);
  return { wrapper, scroller, setRef };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useTableScrollEdges", () => {
  it("marks both edges reached when the table does not overflow", () => {
    const { wrapper } = attach({
      scrollLeft: 0,
      clientWidth: 500,
      scrollWidth: 500,
    });
    // No overflow → at start AND at end → neither pinned column casts a shadow.
    expect(wrapper.dataset.scrollStart).toBe("true");
    expect(wrapper.dataset.scrollEnd).toBe("true");
  });

  it("reports not-at-end at the left of an overflowing table", () => {
    const { wrapper } = attach({
      scrollLeft: 0,
      clientWidth: 300,
      scrollWidth: 900,
    });
    // At the start, more to the right → right column shadows (scroll-end=false).
    expect(wrapper.dataset.scrollStart).toBe("true");
    expect(wrapper.dataset.scrollEnd).toBe("false");
  });

  it("reports not-at-start once scrolled away from the left", () => {
    const { wrapper } = attach({
      scrollLeft: 120,
      clientWidth: 300,
      scrollWidth: 900,
    });
    // Mid-scroll → both columns shadow (more to scroll either way).
    expect(wrapper.dataset.scrollStart).toBe("false");
    expect(wrapper.dataset.scrollEnd).toBe("false");
  });

  it("marks the end reached after scrolling fully right", () => {
    const { wrapper } = attach({
      scrollLeft: 600,
      clientWidth: 300,
      scrollWidth: 900,
    });
    // scrollLeft(600) + clientWidth(300) === scrollWidth(900) → at the end.
    expect(wrapper.dataset.scrollStart).toBe("false");
    expect(wrapper.dataset.scrollEnd).toBe("true");
  });

  it("updates the edges when the scroll container scrolls", () => {
    const { wrapper, scroller } = attach({
      scrollLeft: 0,
      clientWidth: 300,
      scrollWidth: 900,
    });
    expect(wrapper.dataset.scrollStart).toBe("true");

    scroller.scrollLeft = 600;
    scroller.dispatchEvent(new Event("scroll"));

    expect(wrapper.dataset.scrollStart).toBe("false");
    expect(wrapper.dataset.scrollEnd).toBe("true");
  });

  it("stops syncing once the wrapper detaches (callback ref called with null)", () => {
    const { wrapper, scroller, setRef } = attach({
      scrollLeft: 0,
      clientWidth: 300,
      scrollWidth: 900,
    });
    setRef(null); // node unmounts → listeners torn down
    wrapper.dataset.scrollStart = "sentinel";

    scroller.scrollLeft = 600;
    scroller.dispatchEvent(new Event("scroll"));

    // The detached listener must not run, so our sentinel is untouched.
    expect(wrapper.dataset.scrollStart).toBe("sentinel");
  });

  it("no-ops when the scroll container is absent (no data-slot match)", () => {
    const wrapper = document.createElement("div");
    document.body.append(wrapper);
    const { result } = renderHook(() => useTableScrollEdges());
    // Attaching to a wrapper with no `[data-slot="table-container"]` must not
    // throw and must leave the dataset untouched.
    expect(() => result.current(wrapper)).not.toThrow();
    expect(wrapper.dataset.scrollStart).toBeUndefined();
    expect(wrapper.dataset.scrollEnd).toBeUndefined();
  });

  it("no-ops when the ref is called with null and no node was attached", () => {
    const { result } = renderHook(() => useTableScrollEdges());
    expect(() => result.current(null)).not.toThrow();
  });

  it("re-attaches to a fresh wrapper after the previous one detached", () => {
    const { result } = renderHook(() => useTableScrollEdges());
    const setRef = result.current;

    const first = makeTable({
      scrollLeft: 0,
      clientWidth: 300,
      scrollWidth: 900,
    });
    setRef(first.wrapper);
    expect(first.wrapper.dataset.scrollEnd).toBe("false");
    setRef(null);

    // A new wrapper (the conditionally-rendered table remounting) must sync too.
    const second = makeTable({
      scrollLeft: 600,
      clientWidth: 300,
      scrollWidth: 900,
    });
    setRef(second.wrapper);
    expect(second.wrapper.dataset.scrollStart).toBe("false");
    expect(second.wrapper.dataset.scrollEnd).toBe("true");
  });
});
