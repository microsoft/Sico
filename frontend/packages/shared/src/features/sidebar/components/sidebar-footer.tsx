import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@sico/ui";
import { useAtomValue } from "jotai";
import { Ellipsis } from "lucide-react";
import { type JSX } from "react";

import { userAtom } from "../../../atoms/auth-atom";
import { UserAvatar } from "../../../components/user-avatar";
import { useLogout } from "../../rbac-login/hooks/use-logout";

export function SidebarFooter({
  collapsed,
}: {
  collapsed: boolean;
}): JSX.Element {
  const user = useAtomValue(userAtom);
  const email = user?.email ?? "";
  const logout = useLogout();
  const userLike = user ?? { email: "" };

  if (collapsed) {
    return (
      <div className="flex h-14 w-full items-center justify-center px-0 py-2">
        <span data-testid="sidebar-user-avatar">
          <UserAvatar user={userLike} size="xs" decorative />
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-14 w-full items-center gap-2 px-2 py-4">
      <div className="flex h-11 min-w-0 flex-1 items-center gap-2 px-2 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span data-testid="sidebar-user-avatar">
            <UserAvatar user={userLike} size="xs" decorative />
          </span>
          <span className="text-foreground-primary min-w-0 flex-1 truncate text-sm font-medium">
            {email}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="subtle"
                size="icon-xs"
                aria-label="Account options"
              />
            }
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => logout.mutate()}>
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
