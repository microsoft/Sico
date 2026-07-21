import { Link } from "@tanstack/react-router";
import { type JSX } from "react";

import { NavRow } from "./nav-row";
import { type NavItemData } from "../types";

// Props are a `NavItemData` (the data shape — `to`/`label`/`icon`) plus the
// resolved `active` state. `to` is a loose string so this one component serves
// both sico's own routes AND downstream extras (whose routes sico can't name
// at the type level — see types.ts). The cost: built-in call sites lose
// literal-route checking (a typo in `to="/digital-worker"` no longer errors at
// compile time). Accepted deliberately to keep a single chrome.
type NavItemProps = NavItemData & {
  readonly active?: boolean;
};

// Route specialisation of `NavRow`: the outer element is a router `<Link>`.
// Interactive (non-route) rows — e.g. dwp's Notification trigger — compose
// `NavRow` directly with their own `<button>`/popover-trigger element.
export function NavItem({
  to,
  icon,
  label,
  active,
}: NavItemProps): JSX.Element {
  return (
    <NavRow
      icon={icon}
      label={label}
      active={active}
      render={<Link to={to} aria-current={active ? "page" : undefined} />}
    />
  );
}
