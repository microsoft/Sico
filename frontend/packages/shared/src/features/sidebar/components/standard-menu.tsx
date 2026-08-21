import { Box } from "lucide-react";
import { type JSX, type ReactNode } from "react";

import { DwSection } from "./dw-section";
import { NavItem } from "./nav-item";
import { type ActiveNavState } from "../hooks/use-active-nav";
import { type NavItemData } from "../types";

type Props = {
  readonly active: ActiveNavState;
  readonly extraNavItems?: readonly NavItemData[];
  readonly menuTopExtras?: ReactNode;
};

// The standard expanded-sidebar menu: Digital Workers group (list preview),
// Projects, and downstream extra nav rows. Shown when NOT inside a specific
// Digital Worker (where the sidebar switches to conversation mode instead).
export function StandardMenu({
  active,
  extraNavItems,
  menuTopExtras,
}: Props): JSX.Element {
  const { nav } = active;
  return (
    <>
      {menuTopExtras}
      <NavItem
        to="/project"
        icon={<Box aria-hidden="true" className="size-5" />}
        label="Projects"
        active={nav === "project"}
      />
      {extraNavItems?.map((item) => (
        <NavItem
          key={item.to}
          to={item.to}
          icon={item.icon}
          label={item.label}
          active={active.isActive(item.to)}
        />
      ))}
      {/* Extra top gap sets the Digital Workers group apart from the nav rows
          above so its list preview doesn't read as another row. */}
      <div className="mt-2">
        <DwSection />
      </div>
    </>
  );
}
