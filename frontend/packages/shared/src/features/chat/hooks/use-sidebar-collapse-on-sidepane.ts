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
