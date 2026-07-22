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

import { type RefObject, useEffect, useRef } from "react";

/**
 * Sidepane accessibility wiring (CE5, partial — focus-on-open + return-on-close;
 * the full Tab trap is deferred, design §10) plus Escape-to-close (MI14).
 * Extracted from the shell so the component stays within the .tsx line budget.
 *
 * Returns the ref to attach to the focusable region. Keyed on `isOpen` (a
 * boolean, NOT the content): a content swap while open (markdown→file, MP13)
 * leaves `isOpen` true, so focus is not yanked on replace-in-place.
 */
export function useSidepaneA11y(
  isOpen: boolean,
  close: () => void,
): RefObject<HTMLElement | null> {
  // `regionRef` is the panel we focus on open; `triggerRef` remembers the
  // element focused BEFORE open (the deliverable chip) to restore on close.
  const regionRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Escape closes from anywhere — a window-level listener catches it even when
  // focus sits outside the panel. Gated on `isOpen` so no listener dangles while
  // closed; `close` is a stable useCallback, so cleanup tears down the exact
  // handler it added (no stale closure, no StrictMode double-bind leak).
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        close();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  // Focus-on-open + return-on-close. On the closed→open edge we capture the
  // trigger FIRST, then steal focus into the panel — order matters, or we'd
  // record the panel as its own trigger. The cleanup runs on the open→close edge
  // (the dep flipped) and on unmount, which is exactly where focus must return.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    triggerRef.current = document.activeElement;
    regionRef.current?.focus();

    return () => {
      // The trigger may have unmounted while the panel was open; only restore to
      // a still-connected, focusable element.
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
      }
    };
  }, [isOpen]);

  return regionRef;
}
