import { Link } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Box, MessageCirclePlus, User as UserIcon } from "lucide-react";
import { type JSX, type ReactNode } from "react";

import { userModeAtom } from "../../../atoms/user-mode-atom";
import { type ActiveNavState } from "../hooks/use-active-nav";
import { type NavItemData } from "../types";
import { RailDwList } from "./rail-dw-list";
import { RailNavItem } from "./rail-nav-item";
import { RailNavRow } from "./rail-nav-row";

// The collapsed rail's icon column has three mutually exclusive faces. Split
// into its own file (rather than an inline nested ternary or a same-file second
// component) to satisfy both `no-nested-ternary` and `no-multi-comp` while
// keeping each function under the line cap. Downstream injections
// (menuTopExtras / extraNavItems) belong to the operator workspace; the
// developer studio is a single-entry face.
export function RailBody({
  active,
  menuTopExtras,
  extraNavItems,
}: {
  readonly active: ActiveNavState;
  readonly menuTopExtras?: ReactNode;
  readonly extraNavItems?: readonly NavItemData[];
}): JSX.Element {
  const { nav, agentId } = active;
  const mode = useAtomValue(userModeAtom);

  if (mode === "developer") {
    return (
      <RailNavItem
        to="/studio"
        label="Studio"
        icon={<UserIcon aria-hidden="true" className="size-5" />}
        active={active.isActive("/studio")}
      />
    );
  }

  if (nav === "dw" && agentId !== null) {
    // L2 conversation mode: mirror the expanded ConversationModeMenu with
    // only the two conversation-mode actions — back to the DW list (user
    // icon, matching the chat page's header affordance) and start a new
    // session (matching the expanded "New session" button). No DW list
    // rail here; the rail-dw-list belongs to the L1 face.
    return (
      <>
        <RailNavItem
          to="/digital-worker"
          label="Back to Digital Workers"
          icon={<UserIcon aria-hidden="true" className="size-5" />}
          active={false}
        />
        {/* New session uses `RailNavRow` directly (not `RailNavItem`) so we
            can pass typed route `params` — the $agentId segment must be
            interpolated at Link resolution time, not baked into `to`. */}
        <RailNavRow
          icon={<MessageCirclePlus aria-hidden="true" className="size-5" />}
          render={
            <Link
              to="/digital-worker/$agentId"
              params={{ agentId }}
              aria-label="New session"
            />
          }
        />
      </>
    );
  }

  return (
    <>
      {menuTopExtras}
      <RailNavItem
        to="/project"
        label="Projects"
        icon={<Box aria-hidden="true" className="size-5" />}
        active={nav === "project"}
      />
      {extraNavItems?.map((item) => (
        <RailNavItem
          key={item.to}
          to={item.to}
          label={item.label}
          icon={item.icon}
          active={active.isActive(item.to)}
        />
      ))}
      <RailNavItem
        to="/digital-worker"
        label="Digital Workers"
        icon={<UserIcon aria-hidden="true" className="size-5" />}
        active={nav === "dw" && agentId === null}
      />

      <RailDwList />
    </>
  );
}
