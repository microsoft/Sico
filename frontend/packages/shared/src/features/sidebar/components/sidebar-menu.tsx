import { User as UserIcon } from "lucide-react";
import { type JSX, type ReactNode } from "react";

import { ConversationModeMenu } from "./conversation-mode-menu";
import { NavItem } from "./nav-item";
import { StandardMenu } from "./standard-menu";
import { type LoginMode } from "../../../components/shell/login-mode-context";
import { type ActiveNavState } from "../hooks/use-active-nav";
import { type NavItemData } from "../types";

type Props = {
  readonly mode: LoginMode;
  readonly active: ActiveNavState;
  readonly extraNavItems?: readonly NavItemData[];
  readonly menuTopExtras?: ReactNode;
};

// The expanded sidebar's nav-list body — three mutually-exclusive faces:
//   - developer mode → a single Studio entry (no DW workspace);
//   - operator mode inside a DW → conversation mode (its conversation list);
//   - operator mode elsewhere → the standard nav (DW group, Projects, extras).
// Extracted so `<ExpandedSidebar>` stays flat (no nested ternary) and within the
// function-length budget.
export function SidebarMenu({
  mode,
  active,
  extraNavItems,
  menuTopExtras,
}: Props): JSX.Element {
  if (mode === "developer") {
    return (
      <NavItem
        to="/studio"
        icon={<UserIcon aria-hidden="true" className="size-5" />}
        label="Studio"
        active={active.isActive("/studio")}
      />
    );
  }
  // Operator: inside a DW (`/digital-worker/$id/...`) the menu lists that DW's
  // conversations; `active.agentId` (non-null when `nav === "dw"`) is the target.
  if (active.nav === "dw" && active.agentId !== null) {
    return <ConversationModeMenu agentId={active.agentId} />;
  }
  return (
    <StandardMenu
      active={active}
      extraNavItems={extraNavItems}
      menuTopExtras={menuTopExtras}
    />
  );
}
