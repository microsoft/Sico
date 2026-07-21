import { useAtomValue } from "jotai";

import { sidebarEffectiveCollapsedAtom } from "../atoms/sidebar-atom";

// Read-only view of the sidebar's EFFECTIVE collapsed state, for downstream apps
// that inject a `menuTopExtras` row needing to switch chrome between the expanded
// (`NavRow`, with label) and collapsed (`RailNavRow`, icon-only) variants. Reads
// the effective atom (persisted preference OR the chat Sidepane's transient
// force-collapse) so an injected row matches the rail the Sidebar actually
// renders — otherwise a Sidepane-forced collapse would leave the row expanded.
// Exposes only the boolean — the atoms stay sidebar-internal so consumers can't
// drive collapse/expand out of band.
export function useSidebarCollapsed(): boolean {
  return useAtomValue(sidebarEffectiveCollapsedAtom);
}
