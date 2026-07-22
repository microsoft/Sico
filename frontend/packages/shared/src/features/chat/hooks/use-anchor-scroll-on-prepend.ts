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

import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

// Hold the user's reading position when an OLDER page prepends at the top.
// Anchor on DISTANCE-FROM-BOTTOM rather than a specific row: track
// `scrollHeight - scrollTop` while a fetch-older is in flight, then restore
// `scrollTop = scrollHeight - distance` after the prepend commits. Inserting
// content ABOVE the viewport grows scrollHeight but leaves the distance from the
// reading position to the bottom unchanged, so this holds the view exactly — and
// unlike a row-element anchor it can't be fooled by a single message taller than
// the viewport (common here: plan/tool cards run 600–1000px).
//
// The distance is tracked CONTINUOUSLY (a scroll listener), not snapshotted once
// when the fetch fires. The sentinel fires the fetch ~200px before the top edge,
// but the user keeps scrolling up during the network round-trip; a stale
// fetch-fire snapshot would restore to where they WERE, yanking the view the
// wrong way (downward) on commit. Tracking to the latest position fixes that.
const SETTLE_MS = 600;

// Restore the captured distance-from-bottom. Reads the container from the ref (a
// local, not a param) so the scrollTop write isn't a param-property mutation.
function restore(
  scrollRef: RefObject<HTMLElement | null>,
  fromBottom: number,
): void {
  const el = scrollRef.current;
  if (!el) {
    return;
  }
  const target = el.scrollHeight - fromBottom;
  if (el.scrollTop !== target) {
    el.scrollTop = target;
  }
}

/**
 * Returns an `arm()` to call the instant a fetch-older fires: it marks a prepend
 * as pending and starts tracking the reading position as a distance from the
 * bottom. A scroll listener keeps that distance current as the user scrolls up
 * during the fetch, so when `topMessageId` changes (the prepend committed) the
 * layout effect restores the user's LATEST position — holding the reading row in
 * place — and keeps re-applying it across a short settle window so async card
 * growth can't shift the view. Composes with `use-stick-to-bottom` (which owns
 * the bottom): a restore only runs when armed by a top prepend, so first load
 * and bottom appends are left to the bottom-stick.
 */
export function useAnchorScrollOnPrepend(
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  topMessageId: string | undefined,
): () => void {
  // Latest distance-from-bottom while a prepend is pending; null when disarmed.
  const fromBottomRef = useRef<number | null>(null);

  const arm = useCallback((): void => {
    const el = scrollRef.current;
    fromBottomRef.current = el ? el.scrollHeight - el.scrollTop : null;
  }, [scrollRef]);

  // Keep the pending distance current as the user scrolls during the fetch. The
  // guard means the listener is inert except in the window between arm() and the
  // prepend commit.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return undefined;
    }
    const onScroll = (): void => {
      if (fromBottomRef.current !== null) {
        fromBottomRef.current = el.scrollHeight - el.scrollTop;
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const fromBottom = fromBottomRef.current;
    fromBottomRef.current = null; // disarm
    if (!el || fromBottom === null) {
      return undefined;
    }
    restore(scrollRef, fromBottom); // pre-paint: no visible jump
    // Keep the distance pinned while late-measuring cards grow above the view.
    const observer = new ResizeObserver(() => {
      restore(scrollRef, fromBottom);
    });
    const content = contentRef.current;
    if (content) {
      observer.observe(content);
    }
    const stop = setTimeout(() => observer.disconnect(), SETTLE_MS);
    return () => {
      clearTimeout(stop);
      observer.disconnect();
    };
  }, [topMessageId, scrollRef, contentRef]);

  return arm;
}
