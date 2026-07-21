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
