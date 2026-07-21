import { Link } from "@tanstack/react-router";
import { type JSX } from "react";

import { RailNavRow } from "./rail-nav-row";
import { type NavItemData } from "../types";

// Same `NavItemData` shape as `<NavItem>` plus the resolved `active` state —
// rail rows render `icon` centered with no label text (it's the aria-label).
// See nav-item.tsx for why `to` is a loose string (single chrome for sico
// routes + downstream extras).
type RailNavItemProps = NavItemData & {
  readonly active: boolean;
};

// Route specialisation of `RailNavRow`: the outer element is a router `<Link>`,
// with `label` becoming its `aria-label` (rail rows show no text).
export function RailNavItem({
  to,
  label,
  icon,
  active,
}: RailNavItemProps): JSX.Element {
  return (
    <RailNavRow
      icon={icon}
      active={active}
      render={<Link to={to} aria-label={label} />}
    />
  );
}
