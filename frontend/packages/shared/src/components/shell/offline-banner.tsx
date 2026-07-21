import type { ReactElement } from "react";

import { useOnlineStatus } from "../../hooks/use-online-status";

/**
 * Always-mounted polite live region. NVDA/JAWS/VoiceOver fire
 * inconsistently when a `role="status"` region mounts at the same time
 * as its content, so the region exists in the AT tree before any
 * offline message is added. When online, it collapses to `sr-only`
 * (no `display:none`, no `empty:hidden` — both remove from the a11y
 * tree); a U+00A0 placeholder keeps `.textContent` non-empty.
 */

const OFFLINE_MESSAGE = "You are offline. Some actions may not work.";
const ONLINE_PLACEHOLDER = "\u00A0";

export function OfflineBanner(): ReactElement {
  const isOnline = useOnlineStatus();
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        isOnline
          ? "sr-only"
          : "bg-status-warning-fill text-status-warning-foreground fixed inset-x-0 top-0 z-50 px-4 py-2 text-center text-sm"
      }
    >
      {isOnline ? ONLINE_PLACEHOLDER : OFFLINE_MESSAGE}
    </div>
  );
}
