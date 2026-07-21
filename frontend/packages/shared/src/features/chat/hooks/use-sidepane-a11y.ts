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
