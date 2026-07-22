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

// Geometry for the ChatGPT-style "pin the newest user message to the top while
// the reply streams below it" behaviour. Ported from assistant-ui's
// `turnAnchor:"top"` (computeTopAnchorSlack.ts). Two pure functions, so the
// math is unit-testable without a DOM:
//   • computeTargetScrollTop — where to scroll so the anchor sits at the top.
//   • computeReserveHeight   — how much filler to add below so that scroll is
//     reachable; it shrinks to 0 as the reply grows.
//
// Both depend ONLY on the anchor's offsetTop + heights, NEVER on
// `scrollHeight` for the target — `scrollHeight` is volatile while the reply
// streams in, and reading it would let the anchor drift frame to frame.

// Breathing room left above the pinned message.
export const ANCHOR_OFFSET_PX = 16;

// use-stick-to-bottom relocks to the bottom when the view is within ~70px of it
// (its STICK_TO_BOTTOM_OFFSET_PX). With an empty reply the reserve would park
// the pinned question right at the scroll-range bottom → the library reads
// "near bottom" and re-locks on any resize, dragging the question down. Keep an
// extra cushion below so we stay clear of that band until the reply fills it.
const STICK_RELOCK_CUSHION_PX = 72;

// Scroll position that pins the anchor (newest user message) to the top of the
// viewport, minus a small offset. A message taller than `tallerThan` is
// intentionally over-scrolled so only `visibleHeight` of it stays on screen —
// a giant question must not fill the viewport and crowd out the reply.
export function computeTargetScrollTop(o: {
  anchorTop: number;
  anchorHeight: number;
  tallerThan: number;
  visibleHeight: number;
}): number {
  const visible =
    o.anchorHeight <= o.tallerThan ? o.anchorHeight : o.visibleHeight;
  const overScroll = Math.max(0, o.anchorHeight - visible);
  return Math.max(0, o.anchorTop - ANCHOR_OFFSET_PX + overScroll);
}

// Filler height needed below the content so `targetScrollTop` is actually
// reachable (the browser clamps scrollTop to `scrollHeight - clientHeight`).
// `scrollHeight` is the CONTENT's height excluding the filler (the filler is a
// sibling, not inside it). The cushion keeps the pinned view clear of
// stick-to-bottom's relock band; as the reply streams in, content grows and this
// shrinks to 0 — no permanent dead space at the bottom.
export function computeReserveHeight(o: {
  targetScrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): number {
  return Math.max(
    0,
    o.targetScrollTop +
      o.clientHeight +
      STICK_RELOCK_CUSHION_PX -
      o.scrollHeight,
  );
}
