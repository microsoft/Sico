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

import { useEffect, useState } from "react";

import { type SidepaneContent } from "../atoms/sidepane-atom";

// Outlives the shell's close transition so the previewer finishes sliding out
// before it unmounts. Kept ~20ms ahead of the `duration-medium-1` (300ms) width
// transition in `sidepane.tsx`; if that token changes, bump this to match (the
// two aren't mechanically coupled — a longer transition would unmount mid-slide,
// a shorter one just delays the drop harmlessly).
const SLIDE_OUT_MS = 320;

/**
 * Retain-then-unmount for the Sidepane's slide-out. The shell animates `width`
 * 0 ↔ 75%; on close `content` flips to null immediately, but the panel still
 * needs its previewer on screen for the ~300ms it takes to slide shut. This
 * returns the last non-null content as `shown` until the slide finishes, then
 * drops it (unmounting the previewer and stopping its file/sandbox polls).
 *
 * `setShown` is called DURING render (React's "store info from previous renders"
 * pattern) so a fresh open adopts the new content synchronously — no empty frame
 * before the previewer appears. Clearing is driven by a TIMER, not
 * `transitionend`, because the close doesn't always run a width transition that
 * would fire one: closing from the maximized overlay (`fixed inset-0`, no width
 * change) and `motion-reduce:transition-none` both skip it. The timer unmounts
 * the previewer regardless — visibly after the slide, or harmlessly ~320ms after
 * an instant close.
 */
export function useRetainedContent(content: SidepaneContent): SidepaneContent {
  const [shown, setShown] = useState<SidepaneContent>(content);

  // Adopt a new open target immediately; never clear here (that is the close
  // path below) — opening a fresh item also cancels any pending slide-out drop.
  if (content !== null && content !== shown) {
    setShown(content);
  }

  useEffect(() => {
    // Open (or mid-swap): keep the previewer mounted.
    if (content !== null) {
      return undefined;
    }
    // Closed: drop the retained previewer once the slide-out has played. The
    // cleanup cancels this if the panel re-opens first.
    const id = setTimeout(() => setShown(null), SLIDE_OUT_MS);
    return () => clearTimeout(id);
  }, [content]);

  return shown;
}
