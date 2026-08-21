import { Button, Spinner } from "@sico/ui";
import { useAtomValue } from "jotai";
import { ArrowDown } from "lucide-react";
import { type JSX, type RefObject, useCallback, useMemo, useRef } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { MessageCard } from "./message/message-card";
import { useInfiniteScrollSentinel } from "../../../hooks/use-infinite-scroll-sentinel";
import { activeHistoryAtom, type Message } from "../atoms/chat-atom";
import { useAnchorScrollOnPrepend } from "../hooks/use-anchor-scroll-on-prepend";
import { useRevealWhenPinned } from "../hooks/use-reveal-when-pinned";
import { useScrollNewHumanToTop } from "../hooks/use-scroll-new-human-to-top";

export type MessageListProps = {
  // Reverse-pagination wiring. Optional so the list renders standalone before
  // Collaboration feeds it `useHistory`'s pager; the defaults mean "no older
  // pages, nothing to fetch", so no sentinel mounts.
  hasMore?: boolean;
  fetchOlder?: () => void;
  isFetchingOlder?: boolean;
};

// True when real content (not the anchor's reserve filler) sits below the fold,
// so the scroll-to-bottom button is worth showing. While the question is pinned
// the gap below is just the spacer — exclude it.
function realContentBelow(
  scrollRef: RefObject<HTMLElement | null>,
  spacerRef: RefObject<HTMLElement | null>,
): boolean {
  const el = scrollRef.current;
  if (!el) {
    return false;
  }
  const reserve = spacerRef.current?.offsetHeight ?? 0;
  return el.scrollHeight - el.scrollTop - el.clientHeight - reserve > 8;
}

// Newest human message id, scanning from the tail. The top-anchor keys on this:
// a fresh send changes it, while streaming AI frames (the tail row) don't.
function lastHumanId(history: Message[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.author === "human") {
      return history[i]?.id;
    }
  }
  return undefined;
}

/**
 * The scrolling history column. Scroll behaviour is split into three concerns:
 *   • Stay-at-bottom (first load + streamed frames + async layout) is owned by
 *     `useStickToBottom` (a spring-driven rAF loop — no flicker, no per-growth
 *     animation stacking).
 *   • Hold-position-on-prepend (reverse pagination) is owned by
 *     `useAnchorScrollOnPrepend` — it captures the reading position as a
 *     distance from the bottom and restores it after the older page commits
 *     (re-pinning across async card growth) so the reading row holds exactly in
 *     place. Native CSS scroll-anchoring is turned OFF (`overflowAnchor: "none"`)
 *     — it fails at `scrollTop === 0` (nothing above the viewport to anchor to)
 *     and would double-compensate.
 *   • Anchor-new-message-to-top (ChatGPT pattern) is owned by
 *     `useScrollNewHumanToTop` — on a fresh send it escapes the bottom lock and
 *     pins the new question near the top so the reply streams in below it,
 *     backed by a trailing reserve spacer that shrinks to 0 as the reply grows.
 * The top sentinel drives reverse pagination. Each turn renders through the
 * memoized `<MessageCard>` router, so a streaming frame re-renders only the tail
 * row. Content is always an auto-escaped React text node — NEVER
 * `dangerouslySetInnerHTML`. No virtualization (de-scoped).
 */
export function MessageList({
  hasMore = false,
  fetchOlder,
  isFetchingOlder = false,
}: MessageListProps): JSX.Element {
  // Scoped subscription: only the active conversation's history.
  const history = useAtomValue(activeHistoryAtom);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);

  const { scrollRef, contentRef, isAtBottom, scrollToBottom, stopScroll } =
    useStickToBottom({ initial: "instant", resize: "smooth" });

  // Reveal once the first pin lands, so the first-load scroll-to-bottom isn't
  // visible. Failsafe-timed inside the hook so a never-settling pin can't hide
  // the list forever.
  const ready = useRevealWhenPinned(scrollRef, history.length > 0);

  // Hold the reading row when an older page prepends. `capturePrepend()` snapshots
  // the reading position the instant the fetch fires; once the prepend commits (the
  // oldest message id changes), the hook restores it — holding the reading row in
  // place — and keeps it pinned across async card growth.
  const capturePrepend = useAnchorScrollOnPrepend(
    scrollRef,
    contentRef,
    history[0]?.id,
  );
  const handleFetchOlder = useCallback((): void => {
    // Skip the cold-load artifact: on first paint the list is pinned to the
    // bottom, but the top sentinel still sits inside its 200px prefetch band and
    // fires once. Fetching then would auto-load page 2 the user never scrolled
    // for. A genuine scroll-to-top to load older history is never at the bottom,
    // so gating on `isAtBottom` suppresses only the spurious first trigger.
    if (isAtBottom) {
      return;
    }
    capturePrepend();
    fetchOlder?.();
  }, [capturePrepend, fetchOlder, isAtBottom]);

  // ChatGPT-style anchor: pin the newest user message to the top of the viewport
  // when a new one is sent, so the streaming reply grows below it instead of
  // shoving the question off-screen. Keyed on the TAIL human id (the prepend
  // hook keys on the HEAD id), so the two never co-fire. Gated on `ready` so it
  // stays inert during the first-load hidden phase.
  const latestHumanId = useMemo(() => lastHumanId(history), [history]);
  const anchorRefs = useMemo(
    () => ({ scroll: scrollRef, content: contentRef, spacer: spacerRef }),
    [scrollRef, contentRef],
  );
  useScrollNewHumanToTop(anchorRefs, latestHumanId, {
    stopScroll,
    enabled: ready,
  });

  // Reverse pagination: the sentinel sits at the TOP, so scrolling up to it pulls
  // the next older page. Mounted unconditionally (not gated on `hasMore`): the
  // observer effect is keyed on the stable `sentinelRef` and runs once, so a
  // sentinel that only appears after `hasMore` flips would never be observed. The
  // hook's own `hasNextPage` guard makes an always-present sentinel a no-op while
  // there's nothing older to fetch. `rootRef` points the observer at the local
  // scroll container (not the viewport) so `rootMargin`'s prefetch lead applies.
  useInfiniteScrollSentinel(
    sentinelRef,
    {
      hasNextPage: hasMore,
      isFetchingNextPage: isFetchingOlder,
      fetchNextPage: handleFetchOlder,
    },
    { rootRef: scrollRef },
  );

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        className="scrollbar h-full overflow-x-hidden"
        style={{
          overflowAnchor: "none",
          // Hide the scrollbar (and its top→bottom slide) during the first-load
          // pin; the bottom pin still works under `hidden` because scrollTop is
          // set programmatically. Switches to `auto` once the content reveals.
          overflowY: ready ? "auto" : "hidden",
        }}
      >
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-190 flex-col gap-4 px-4 pt-4 pb-14"
          style={{ visibility: ready ? "visible" : "hidden" }}
        >
          <div ref={sentinelRef} aria-hidden="true" />
          {isFetchingOlder && (
            <div className="flex w-full items-center justify-center py-2">
              <Spinner aria-label="Loading older messages" />
            </div>
          )}
          {history.map((message) => (
            <MessageCard key={message.id} message={message} />
          ))}
        </div>
        {/* Reserve filler for the ChatGPT-style top anchor. Sized imperatively by
            the hook to make the new question reachable at the top, then shrunk to
            0 as the reply streams in. It's a SIBLING of contentRef (not a child):
            use-stick-to-bottom observes contentRef, so a child spacer's shrink
            would read as a negative resize and re-lock the view to the bottom,
            yanking the pinned question down — keeping it outside contentRef
            severs that. */}
        <div ref={spacerRef} aria-hidden="true" />
      </div>
      {/* Show only when REAL content sits below the fold — exclude the anchor's
          reserve filler so the button doesn't appear while the new question is
          pinned and the gap below is just spacer. `isAtBottom` re-renders on
          escape, so this geometry read is current. */}
      {!isAtBottom && realContentBelow(scrollRef, spacerRef) && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Scroll to newest message"
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full"
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}
