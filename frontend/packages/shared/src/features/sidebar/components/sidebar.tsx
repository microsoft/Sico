import { useAtomValue, useSetAtom } from "jotai";
import { type JSX, type ReactNode } from "react";

import { CollapsedRail } from "./collapsed-rail";
import { ExpandedSidebar } from "./expanded-sidebar";
import { SidebarFooter } from "./sidebar-footer";
import {
  sidebarCollapsedAtom,
  sidebarEffectiveCollapsedAtom,
  sidebarForcedCollapsedAtom,
} from "../atoms/sidebar-atom";
import { type ActiveNav, useActiveNav } from "../hooks/use-active-nav";
import { type NavItemData } from "../types";

type SidebarProps = {
  // Data-driven nav entries appended after the built-in items (Digital
  // Workers, Projects). Default `undefined` — sico shows none; a downstream
  // app (dwp) passes e.g. a My Team entry. sico renders each with its own
  // `NavItem`/`RailNavItem` chrome (expanded + collapsed), so the app supplies
  // only the route + icon, never the styling. See `NavItemData`.
  readonly extraNavItems?: readonly NavItemData[];
  // Header-area slot (top bar when expanded, rail top when collapsed). Default
  // `undefined`; dwp injects the notification bell. Stays a free-form slot
  // (not data) because the bell is custom interactive UI, not a nav link.
  readonly headerExtras?: ReactNode;
  // Free-form slot rendered at the TOP of the menu list (above Digital
  // Workers), mirroring `extraNavItems` which appends at the bottom. Default
  // `undefined`; dwp injects the Notification row here. Free-form (not data)
  // because it's an interactive row — badge + popover trigger — not a route
  // link. Compose it from `NavRow`/`RailNavRow` so it matches the built-in rows.
  readonly menuTopExtras?: ReactNode;
};

export function Sidebar({
  extraNavItems,
  headerExtras,
  menuTopExtras,
}: SidebarProps): JSX.Element {
  // Display reads the EFFECTIVE state (persisted preference OR the chat
  // Sidepane's transient force-collapse); the toggle buttons write only the
  // PERSISTED atom, so a user collapse/expand still survives reloads.
  const collapsed = useAtomValue(sidebarEffectiveCollapsedAtom);
  const setCollapsed = useSetAtom(sidebarCollapsedAtom);
  const setForced = useSetAtom(sidebarForcedCollapsedAtom);
  const active = useActiveNav();

  // Manual expand must win over the Sidepane's force-collapse, so it clears the
  // transient atom too — otherwise `effective` would stay collapsed and the
  // click would be a no-op. A later Sidepane re-open re-collapses (its effect
  // re-runs), which is the intended behavior.
  const onExpand = (): void => {
    setForced(false);
    setCollapsed(false);
  };

  return (
    <nav
      aria-label="Primary navigation"
      data-collapsed={collapsed || undefined}
      className="bg-surface-sunken duration-medium-1 ease-persistent flex h-full shrink-0 flex-col transition-[width] not-data-[collapsed]:w-84 data-[collapsed]:w-11"
    >
      {collapsed ? (
        <CollapsedRail
          active={active}
          onExpand={onExpand}
          extraNavItems={extraNavItems}
          headerExtras={headerExtras}
          menuTopExtras={menuTopExtras}
        />
      ) : (
        <ExpandedSidebar
          active={active}
          onToggleCollapse={() => setCollapsed(true)}
          extraNavItems={extraNavItems}
          headerExtras={headerExtras}
          menuTopExtras={menuTopExtras}
        />
      )}

      <SidebarFooter collapsed={collapsed} />
    </nav>
  );
}

export type { ActiveNav };
