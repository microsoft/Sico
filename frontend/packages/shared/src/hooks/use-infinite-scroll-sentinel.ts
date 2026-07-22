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

import { type RefObject, useEffect, useRef } from "react";

import { logger } from "../utils/logger";

type InfiniteScrollState = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

type InfiniteScrollOptions = {
  // Scroll container the sentinel lives in. Omit (or pass a ref whose
  // `.current` is null) to observe against the viewport — the default.
  // Pass the local-scroll container's ref when the list scrolls inside a
  // bounded element rather than the page, so the sentinel is measured
  // relative to that container instead of the viewport.
  rootRef?: RefObject<HTMLElement | null>;
  // Keep fetching after each page COMPLETES while the sentinel is still
  // intersecting, until it leaves view (container filled) or `hasNextPage`
  // turns false. Default `false`. Enable for FORWARD-paginated lists whose
  // first pages may be shorter than the container (e.g. the sidebar
  // conversation list): without it, IO fires no new intersection after a
  // short page settles, so pagination stalls one page in with empty space
  // below. Leave OFF for reverse pagination (chat history), where scroll-
  // anchoring keeps the sentinel in the band and fill-on-complete would drain
  // every page in one burst.
  fillOnComplete?: boolean;
};

/**
 * Wires an `IntersectionObserver` on `sentinelRef` that triggers
 * `fetchNextPage` when it enters the root (viewport by default, or
 * `options.rootRef`'s element for local scroll). Use with a `<div
 * ref={sentinelRef} aria-hidden />` placed after the list.
 *
 * Why the indirection: `IntersectionObserver` only fires on transition
 * (out↔in). If the sentinel is already inside the rootMargin when the
 * first page resolves and flips `hasNextPage` `false→true`, no event
 * fires and pagination stalls until the user scrolls. We work around
 * this by also triggering a fetch directly when `hasNextPage` flips on
 * while the sentinel is intersecting.
 *
 * All mutable callbacks/state live in refs so the observer is created
 * exactly once per `sentinelRef` / `rootRef` change — no churn on every
 * render.
 */
export function useInfiniteScrollSentinel(
  sentinelRef: RefObject<HTMLElement | null>,
  { hasNextPage, isFetchingNextPage, fetchNextPage }: InfiniteScrollState,
  options?: InfiniteScrollOptions,
): void {
  const stateRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  // Write in an effect, not during render — React 19 concurrent
  // rendering can discard a render pass, leaving the ref desynced.
  useEffect(() => {
    stateRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage };
  });

  const isIntersectingRef = useRef(false);
  // Consecutive fill-on-complete pokes since the last real intersection event.
  // A genuine fill needs only a handful of pages (container height / row
  // height); an unbounded run means a pathological backend (`hasNext:true` with
  // an empty page → the list never grows, the sentinel never leaves the band).
  // Reset on every real IO callback (user scroll) so normal filling never nears
  // the cap; only a runaway trips it.
  const fillPokeCountRef = useRef(0);

  const rootRef = options?.rootRef;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) {
      return undefined;
    }
    const tryFetch = (): void => {
      const s = stateRef.current;
      if (s.hasNextPage && !s.isFetchingNextPage) {
        void s.fetchNextPage();
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        isIntersectingRef.current = entry?.isIntersecting ?? false;
        // A real intersection event is a genuine scroll — reset the fill guard.
        fillPokeCountRef.current = 0;
        if (isIntersectingRef.current) {
          tryFetch();
        }
      },
      // `root: null` observes the viewport (page scroll); a local-scroll
      // container ref measures against that element instead. Effects run
      // after DOM mount, so a same-tree container ref is already populated
      // here.
      { root: rootRef?.current ?? null, rootMargin: "200px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [sentinelRef, rootRef]);

  // IO only fires on transition, so two edge cases need a manual poke while the
  // sentinel is already intersecting: `hasNextPage` false→true (cold load), and
  // — for `fillOnComplete` lists — each fetch completing without the list having
  // grown past the container. Extracted to keep this hook within the line budget.
  useEdgeCompensation(
    { hasNextPage, isFetchingNextPage, fetchNextPage },
    options?.fillOnComplete ?? false,
    isIntersectingRef,
    fillPokeCountRef,
  );
}

// Max consecutive fill-on-complete pokes without a real intersection before the
// safety valve stops (guards a `hasNext:true` + empty-page backend from an
// unbounded fetch loop). Far above any real container's page count.
const FILL_POKE_CAP = 20;

// The two manual-poke effects (rising edge + fill-on-complete), split out of
// `useInfiniteScrollSentinel` so each stays small and independently readable.
function useEdgeCompensation(
  { hasNextPage, isFetchingNextPage, fetchNextPage }: InfiniteScrollState,
  fillOnComplete: boolean,
  isIntersectingRef: RefObject<boolean>,
  fillPokeCountRef: RefObject<number>,
): void {
  // `hasNextPage` false→true while already intersecting: IO won't re-fire (no
  // transition), so poke once on the RISING EDGE. Edge-gated so the effect —
  // which also runs when `isFetchingNextPage` settles — doesn't burst-fetch.
  const prevHasNextPageRef = useRef(hasNextPage);
  useEffect(() => {
    const roseToTrue = hasNextPage && !prevHasNextPageRef.current;
    prevHasNextPageRef.current = hasNextPage;
    if (roseToTrue && !isFetchingNextPage && isIntersectingRef.current) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, isIntersectingRef]);

  // Fill-on-complete (opt-in): after a fetch COMPLETES (isFetchingNextPage
  // true→false) while still intersecting, poke the next fetch so a forward-
  // paginated list keeps loading until its content overflows the container. Once
  // a fresh page makes the list taller than the container, the sentinel leaves
  // the band, IO sets isIntersecting=false, and this stops — natural termination.
  // The `FILL_POKE_CAP` guard is a backstop for a backend that reports more pages
  // but returns empty ones (list never grows, sentinel never leaves): without it
  // this would poke forever.
  const prevIsFetchingRef = useRef(isFetchingNextPage);
  useEffect(() => {
    const settled = prevIsFetchingRef.current && !isFetchingNextPage;
    prevIsFetchingRef.current = isFetchingNextPage;
    const wantsPoke =
      fillOnComplete && settled && hasNextPage && isIntersectingRef.current;
    if (wantsPoke && fillPokeCountRef.current < FILL_POKE_CAP) {
      fillPokeCountRef.current += 1;
      void fetchNextPage();
    } else if (wantsPoke && fillPokeCountRef.current === FILL_POKE_CAP) {
      // The safety valve just tripped: the list wants more pages but they're not
      // making it taller (a hasNext:true backend returning empty pages), so the
      // sentinel never leaves the band. Bump past the cap so this warns ONCE, not
      // on every subsequent settle, and log so the pathological backend is
      // visible instead of a silent give-up.
      fillPokeCountRef.current += 1;
      logger.warn(
        "infinite-scroll: fill-on-complete cap reached; backend reports more pages but the list is not growing — pagination stopped",
        { cap: FILL_POKE_CAP },
      );
    }
  }, [
    fillOnComplete,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isIntersectingRef,
    fillPokeCountRef,
  ]);
}
