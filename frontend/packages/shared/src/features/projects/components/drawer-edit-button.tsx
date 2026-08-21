import { Button } from "@sico/ui";
import { Pencil } from "lucide-react";
import type * as React from "react";

export type DrawerEditButtonProps = {
  /** project.manage — from the workspace-level permission fetch. */
  canManageProject: boolean;
  onEditProject: () => void;
};

/**
 * The project-edit pencil in the drawer meta block. Rendered only for admins
 * (`canManageProject`). Permission is resolved once at the workspace level and
 * passed down — the button no longer self-fetches, so the whole meta block
 * resolves with the page-level skeleton instead of popping in.
 */
export function DrawerEditButton({
  canManageProject,
  onEditProject,
}: DrawerEditButtonProps): React.JSX.Element | null {
  if (!canManageProject) {
    return null;
  }
  return (
    <Button
      variant="subtle"
      size="icon-sm"
      aria-label="Edit project"
      className="text-foreground-secondary hover:text-foreground-primary shrink-0"
      onClick={onEditProject}
    >
      <Pencil />
    </Button>
  );
}
