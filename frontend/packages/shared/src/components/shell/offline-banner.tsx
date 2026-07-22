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
