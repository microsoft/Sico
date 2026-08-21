import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@sico/ui";
import { Ellipsis, Trash2 } from "lucide-react";
import type * as React from "react";

export type DrawerActionsMenuProps = {
  /** project.manage — from the workspace-level permission fetch. */
  canManageProject: boolean;
  /** Opens the delete-project confirm dialog the workspace owns. */
  onRequestDelete: () => void;
};

/**
 * The `…` overflow menu in the project drawer header (shell `actions` slot).
 * Rendered only for admins (`canManageProject`) — deleting a project is
 * `project.manage`. Permission is resolved once at the workspace level and
 * passed down, so the menu resolves with the page-level skeleton.
 */
export function DrawerActionsMenu({
  canManageProject,
  onRequestDelete,
}: DrawerActionsMenuProps): React.JSX.Element | null {
  if (!canManageProject) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="subtle"
            size="icon-sm"
            aria-label="Project actions"
          />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44!">
        <DropdownMenuItem variant="destructive" onClick={onRequestDelete}>
          <Trash2 />
          Delete project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
