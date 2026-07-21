import { useRouterState } from "@tanstack/react-router";
import { type RefObject, useEffect } from "react";

/**
 * Move keyboard focus to the first `<h1>` inside `mainRef` on every
 * committed route change. Pages own the heading + `tabIndex={-1}`.
 *
 * Subscribes to `resolvedLocation` (the committed URL) not `location`
 * (the pending URL) so the effect fires after the outlet has swapped in.
 * Async / code-split routes will silently no-op on first paint until the
 * `<h1>` mounts — current scaffold has none.
 */
export function useFocusFirstHeading(
  mainRef: RefObject<HTMLElement | null>,
): void {
  const pathname = useRouterState({
    select: (s) => s.resolvedLocation?.pathname ?? s.location.pathname,
  });
  useEffect(() => {
    const h1 = mainRef.current?.querySelector<HTMLHeadingElement>("h1");
    h1?.focus();
  }, [pathname, mainRef]);
}
