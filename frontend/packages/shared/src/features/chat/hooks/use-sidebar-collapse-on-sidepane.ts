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

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import { sidebarForcedCollapsedAtom } from "../../sidebar/atoms/sidebar-atom";
import { sidepaneContentAtom } from "../atoms/sidepane-atom";

/**
 * Force-collapses the main Sidebar while the chat Sidepane is open — the preview
 * panel takes ~75% of the row, so the nav rail steps aside to keep the chat
 * usable, exactly like dwp.
 *
 * Lives here (not in the Sidepane shell) because the Sidebar mounts at the app
 * shell while the Sidepane mounts deep in the route — they share only the global
 * store, so the link goes through `sidebarForcedCollapsedAtom`.
 *
 * Drives the TRANSIENT `sidebarForcedCollapsedAtom`, never the persisted
 * `sidebarCollapsedAtom`: writing the persisted atom would commit the forced
 * collapse to localStorage, and a reload-with-pane-open (no cleanup) would
 * overwrite the user's "expanded" preference. The transient atom resets on
 * reload, so the preference is safe; the effect cleanup clears it on every close
 * path (X / Escape / agent-switch reset all null `sidepaneContentAtom`).
 */
export function useSidebarCollapseOnSidepane(): void {
  const setForced = useSetAtom(sidebarForcedCollapsedAtom);
  const isOpen = useAtomValue(sidepaneContentAtom) !== null;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    setForced(true);
    return () => setForced(false);
  }, [isOpen, setForced]);
}
