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

import { type RefObject, useLayoutEffect, useRef } from "react";

import {
  computeReserveHeight,
  computeTargetScrollTop,
} from "../utils/compute-top-anchor";

// ChatGPT-style anchor: when the user sends a new message, pin THAT message near
// the top of the viewport so the reply streams in below it instead of shoving
// the question off-screen. Ported from assistant-ui's `turnAnchor:"top"`.
//
// Composes with `use-stick-to-bottom` (which owns the bottom). The library's
// content ResizeObserver re-pins to the bottom on every positive resize WHILE
// `isAtBottom` — so streaming would yank the view back down. We call the
// library's `stopScroll()` first to escape that lock; afterwards its animation
// loop bails immediately (`if (!isAtBottom) return`) and our anchor holds.
//
// A trailing reserve spacer gives the scroll room to lift the message to the
// top before the reply has grown; its height is written imperatively (never
// React state) so streaming frames don't re-render, and it shrinks to 0 as the
// reply fills in — no permanent dead space, so the library's "bottom" stays
// correct for first load and short threads.

// Keep the reply ~a third of the viewport visible below an over-scrolled tall
// question. Per assistant-ui, both the over-scroll threshold and the retained
// slice scale with the viewport.
const MIN_REPLY_FRACTION = 0.35;

// Anchor's top within the scroll container, as a scroll position. Measured by
// rect delta + current scrollTop, which is invariant to the current scroll
// offset and — crucially — doesn't depend on `offsetParent`. The scroll
// container is `position: static`, so `offsetParent` SKIPS it (it resolves to
// the outer positioned wrapper); an offsetTop walk keyed on the container would
// never reach it and would over-measure, over-scrolling the message off the top.
function anchorOffsetWithin(node: HTMLElement, scroller: HTMLElement): number {
  return (
    node.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop
  );
}

// Scroll position that puts the anchor at the top, and the filler needed below
// to make that reachable. Returns null when the anchor isn't found.
//
// Content height is read from the CONTENT element, not `el.scrollHeight`: when
// the content underflows the viewport the browser clamps `el.scrollHeight` up to
// `clientHeight`, hiding the true (smaller) height and making the reserve come
// out too small to lift a short thread's question to the top. The content
// element's own `scrollHeight` reports the real height. The spacer is a sibling
// (not inside content), so it isn't counted here.
function measure(
  el: HTMLElement,
  content: HTMLElement,
  anchorId: string,
): { target: number; reserve: number } | null {
  const anchor = el.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(anchorId)}"]`,
  );
  if (!anchor) {
    return null;
  }
  const threshold = el.clientHeight * (1 - MIN_REPLY_FRACTION);
  const target = computeTargetScrollTop({
    anchorTop: anchorOffsetWithin(anchor, el),
    anchorHeight: anchor.offsetHeight,
    tallerThan: threshold,
    visibleHeight: threshold,
  });
  const reserve = computeReserveHeight({
    targetScrollTop: target,
    clientHeight: el.clientHeight,
    scrollHeight: content.scrollHeight,
  });
  return { target, reserve };
}

type AnchorRefs = {
  scroll: RefObject<HTMLElement | null>;
  content: RefObject<HTMLElement | null>;
  spacer: RefObject<HTMLElement | null>;
};

type Options = {
  stopScroll: () => void;
  enabled: boolean;
};

// Pin the anchor to the top ONCE, then watch the reply stream in and SHRINK the
// filler back. The view STAYS pinned on the question for the whole reply (a
// focused-reading hold) — it does NOT auto-follow the streaming tail. Following
// is the user's choice: `stopScroll()` here puts the library into its escaped
// state, and use-stick-to-bottom's own scroll handler re-engages the bottom
// follow the moment the user scrolls down toward it. Reads nodes from refs
// (locals, not params) so the scrollTop/style writes aren't param-property
// mutations.
function anchorToTop(
  refs: AnchorRefs,
  anchorId: string,
  stopScroll: () => void,
): () => void {
  const el = refs.scroll.current;
  const spacer = refs.spacer.current;
  const content = refs.content.current;
  if (!el || !spacer || !content) {
    return () => {};
  }
  const initial = measure(el, content, anchorId);
  // Nothing to do when the anchor is already at (or above) the target — e.g. the
  // first message in a thread sits at the top with no room or need to lift it.
  if (!initial || initial.target <= 0) {
    return () => {};
  }
  // Order matters — the browser clamps scrollTop to the current scroll range, so
  // the filler must exist before we scroll. `minHeight` (not `height`): the
  // content is a flex column, and an explicit `height` on a flex child is
  // ignored while the column underflows the viewport, so the filler wouldn't
  // grow the scroll range and the question couldn't lift. `minHeight` forces it.
  stopScroll();
  spacer.style.minHeight = `${initial.reserve}px`;
  el.scrollTop = initial.target;

  // The target depends on the anchor's offset (stable), not scrollHeight, so we
  // only resize the filler as real content arrives; stop once it hits 0 (the
  // reply filled the gap — no dead space). We never re-scroll: the question
  // stays put. MutationObserver too, because plain-text appends may not trigger
  // a resize.
  const shrink = (): void => {
    const next = measure(el, content, anchorId);
    if (!next) {
      return;
    }
    spacer.style.minHeight = `${next.reserve}px`;
    if (next.reserve === 0) {
      resize.disconnect();
      mutation.disconnect();
    }
  };
  const resize = new ResizeObserver(shrink);
  const mutation = new MutationObserver(shrink);
  resize.observe(content);
  mutation.observe(content, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => {
    resize.disconnect();
    mutation.disconnect();
  };
}

/**
 * Pins the newest human message to the top of `scrollRef` whenever
 * `latestHumanId` changes (a fresh send). `spacerRef` points at a trailing
 * zero-height filler the hook grows/shrinks to make the scroll reachable.
 * `enabled` gates the whole thing on first-load readiness; `stopScroll` escapes
 * the bottom lock before scrolling. Keyed on the TAIL message id, while
 * `useAnchorScrollOnPrepend` keys on the HEAD id, so the two never co-fire.
 */
export function useScrollNewHumanToTop(
  refs: AnchorRefs,
  latestHumanId: string | undefined,
  { stopScroll, enabled }: Options,
): void {
  const prevIdRef = useRef(latestHumanId);

  useLayoutEffect(() => {
    const prevId = prevIdRef.current;
    prevIdRef.current = latestHumanId;
    const el = refs.scroll.current;
    const spacer = refs.spacer.current;
    if (
      !enabled ||
      !latestHumanId ||
      latestHumanId === prevId ||
      !el ||
      !spacer
    ) {
      return undefined;
    }
    return anchorToTop(refs, latestHumanId, stopScroll);
  }, [latestHumanId, enabled, refs, stopScroll]);
}
