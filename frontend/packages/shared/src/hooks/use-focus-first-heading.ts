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
