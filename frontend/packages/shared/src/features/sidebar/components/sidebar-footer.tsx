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
