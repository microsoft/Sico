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

import { type RefObject, useLayoutEffect, useState } from "react";

// Suppress the first-load "scroll to latest" motion: the list paints at the top
// (scrollTop 0) for a few frames before stick-to-bottom pins it to the bottom.
// Keep content hidden until that first pin lands (distance-to-bottom collapses,
// or the content fits), then reveal — the user sees the newest message with no
// visible scroll. Flips once and stays true. Failsafe: reveal after ~1s anyway
// so a never-settling pin (content that keeps growing) can't hide the list
// forever. Returns `ready`.
export function useRevealWhenPinned(
  scrollRef: RefObject<HTMLElement | null>,
  hasContent: boolean,
): boolean {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (ready || !hasContent) {
      return undefined;
    }
    let raf = 0;
    const deadline = performance.now() + 1000;
    const poll = (): void => {
      const el = scrollRef.current;
      if (!el) {
        raf = requestAnimationFrame(poll);
        return;
      }
      const pinned = el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
      if (pinned || performance.now() >= deadline) {
        setReady(true);
      } else {
        raf = requestAnimationFrame(poll);
      }
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [ready, hasContent, scrollRef]);
  return ready;
}
