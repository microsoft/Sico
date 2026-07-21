import { useCallback, useRef } from "react";

// 1px slack: sub-pixel layout (zoom, fractional widths) can leave a scroll edge a
// hair off from the exact 0 / scrollWidth boundary, so a strict comparison would
// keep an edge fade on forever. One pixel of tolerance reads as "at the edge".
const EDGE_SLACK = 1;

// Resolve the @sico/ui scroll node, attach the scroll/resize sync, and return a
// teardown — or null when the wrapper/scroller isn't there yet. Module-scope so
// the callback ref below stays a thin attach/detach shim.
function attachEdgeSync(wrapper: HTMLElement): (() => void) | null {
  const scroller = wrapper.querySelector<HTMLElement>(
    '[data-slot="table-container"]',
  );
  if (!scroller) {
    return null;
  }
  // Local alias so the writes below aren't a (banned) param-property reassign.
  const { dataset } = wrapper;

  const sync = (): void => {
    const atStart = scroller.scrollLeft <= EDGE_SLACK;
    const atEnd =
      scroller.scrollLeft + scroller.clientWidth >=
      scroller.scrollWidth - EDGE_SLACK;
    // Pinned cells gate their frosted fade on `scroll-start=false` / `scroll-end=false`.
    dataset.scrollStart = String(atStart);
    dataset.scrollEnd = String(atEnd);
  };

  sync();
  scroller.addEventListener("scroll", sync, { passive: true });
  // Width changes (sidepane open, window resize) flip whether the table overflows
  // at all; observing the inner `<table>` also catches content-driven width
  // growth (a longer name) that doesn't resize the scroll container itself.
  const observer = new ResizeObserver(sync);
  observer.observe(scroller);
  const table = scroller.querySelector<HTMLElement>('[data-slot="table"]');
  if (table) {
    observer.observe(table);
  }

  return (): void => {
    scroller.removeEventListener("scroll", sync);
    observer.disconnect();
  };
}

/**
 * Drives the assets table's pinned-column frosted edges. The pinned first/last
 * columns (see `pinned-columns.ts`) fade their fill to transparent (`mask-image`)
 * and blur the content peeking through (`backdrop-blur-sm`) toward the scrollable
 * middle — but only while there is more to scroll that way, so the fade signals
 * "scroll here" and snaps to a solid edge at each extreme.
 *
 * `@sico/ui`'s `<Table>` owns the horizontal scroll container internally and
 * doesn't forward a ref, so the returned **callback ref** goes on a projects-owned
 * `group/table` wrapper around it; the hook finds the scroll node via its stable
 * `data-slot` and writes `data-scroll-start` / `data-scroll-end` back onto the
 * wrapper. The pinned cells read those with `group-data-[scroll-*]/table:`
 * variants — pure CSS, no React re-render per scroll frame.
 *
 * A callback ref (not a `RefObject` + effect) is deliberate: the wrapper is
 * conditionally rendered (it unmounts when a search empties the table), and a
 * callback ref re-attaches on every mount and tears down on every unmount — an
 * effect keyed on the stable ref object would run only once and leak / go dead
 * across those remounts.
 */
export function useTableScrollEdges(): (node: HTMLElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((node: HTMLElement | null): void => {
    // Node detaching (or React swapping it): tear down the previous listeners.
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (node) {
      cleanupRef.current = attachEdgeSync(node);
    }
  }, []);
}
