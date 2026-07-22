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

import { useEffect, useMemo, useState } from "react";

// Typewriter-style smoothing for streamed text. The backend pushes text in
// network-sized chunks (tens to hundreds of chars at once), so a raw render
// jumps in jerky bursts. This reveals the backlog of not-yet-shown characters
// at a steady per-character rate instead, so text appears to type in smoothly.
// Ported from assistant-ui's `useSmooth` (TextStreamAnimator), trimmed to a
// store-agnostic hook over a plain (text, streaming) pair.

// Target time to drain the whole backlog; a longer backlog reveals faster so it
// never lags further and further behind the real stream.
const DRAIN_MS = 250;
// Slowest per-character interval (when the backlog is short), so a trickle of
// text still feels animated rather than frozen.
const MAX_CHAR_INTERVAL_MS = 5;

// Drives a rAF loop that walks `current` toward `target` one slice at a time.
// `Date.now`-based so a backgrounded tab (throttled rAF) catches up correctly.
class TextStreamAnimator {
  private frame: number | null = null;
  private lastTick = 0;
  target: string;

  constructor(
    public current: string,
    private readonly commit: (text: string) => void,
  ) {
    this.target = current;
  }

  start(): void {
    if (this.frame !== null) {
      return;
    }
    this.lastTick = Date.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  // Point the animator at `next`. A continuation (next extends the current
  // target) keeps the cursor so the reveal flows on; a discontinuity rewinds the
  // cursor to 0 so we don't back-spell from a stale prefix.
  retarget(next: string): void {
    if (!next.startsWith(this.target)) {
      this.current = "";
    }
    this.target = next;
    this.start();
  }

  private readonly tick = (): void => {
    const now = Date.now();
    let budget = now - this.lastTick;
    const remaining = this.target.length - this.current.length;
    const perChar = Math.min(MAX_CHAR_INTERVAL_MS, DRAIN_MS / remaining);

    let add = 0;
    while (budget >= perChar && add < remaining) {
      add += 1;
      budget -= perChar;
    }
    this.frame = add < remaining ? requestAnimationFrame(this.tick) : null;
    if (add === 0) {
      return;
    }
    this.current = this.target.slice(0, this.current.length + add);
    this.lastTick = now - budget;
    this.commit(this.current);
  };
}

/**
 * Reveals `text` with a typewriter animation while `streaming` is true. Returns
 * the progressively-revealed prefix; once the reveal catches up (or `streaming`
 * goes false, or `prefers-reduced-motion` is set) it returns the full text. A
 * discontinuity (the new text isn't a continuation of what's shown, e.g. a
 * different message) resyncs instantly rather than back-spelling.
 */
export function useSmoothText(text: string, streaming: boolean): string {
  const reduceMotion = usePrefersReducedMotion();
  const enabled = streaming && !reduceMotion;

  const [shown, setShown] = useState(enabled ? "" : text);

  // Render-phase resync: if the shown text is no longer a prefix of the target
  // (message swap, edit), restart from empty (streaming) or jump to full.
  const [prevText, setPrevText] = useState(text);
  if (text !== prevText && !text.startsWith(shown)) {
    setPrevText(text);
    setShown(enabled ? "" : text);
  } else if (text !== prevText) {
    setPrevText(text);
  }

  const [animator] = useState(() => new TextStreamAnimator(shown, setShown));

  useEffect(() => {
    if (enabled) {
      animator.retarget(text);
    } else {
      animator.stop();
    }
  }, [animator, enabled, text]);

  useEffect(() => () => animator.stop(), [animator]);

  return enabled ? shown : text;
}

// `matchMedia`-backed, SSR-safe. Tests stub `matchMedia` (setup.ts) to report
// no match, so smoothing is on by default under test.
function usePrefersReducedMotion(): boolean {
  const query = useMemo(
    () =>
      typeof window !== "undefined" && "matchMedia" in window
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null,
    [],
  );
  const [reduce, setReduce] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) {
      return undefined;
    }
    const onChange = (): void => setReduce(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [query]);
  return reduce;
}
