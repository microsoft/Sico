import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  TableCell,
  TableRow,
} from "@sico/ui";
import { ChevronDown, MoreHorizontal, Trash2 } from "lucide-react";
import type * as React from "react";

import { UserAvatar } from "../../../components/user-avatar";
import { ConfirmDialog } from "../../projects/components/confirm-dialog";
import { GatedMenuItem } from "../../projects/components/gated-menu-item";
import { formatLastActive } from "../../projects/utils/format-last-active";
import { MEMBER_ROLE_LABELS } from "../../rbac";
import { type RoleCode, RoleCodeSchema } from "../../rbac/schemas/user-role";
import { useMemberRowActions } from "../hooks/use-member-row-actions";
import { type ProjectMember } from "../schemas/member";

export type HumanRowProps = {
  projectId: number;
  member: ProjectMember;
  /** The project owner's row: read-only "Owner" role, no actions, for anyone. */
  isOwner: boolean;
  canManage: boolean;
};

/** One Humans-table row. An admin gets an editable role dropdown + a gated
 * Remove; a non-admin sees plain role text and a greyed Remove. The owner row is
 * immutable — no role change, no remove. Row state lives in
 * {@link useMemberRowActions}, so this stays presentational. */
export function HumanRow({
  projectId,
  member,
  isOwner,
  canManage,
}: HumanRowProps): React.JSX.Element {
  const {
    confirmRemove,
    setConfirmRemove,
    onChangeRole,
    onRemove,
    removePending,
  } = useMemberRowActions(projectId, member);
  const display = member.alias ?? member.email;
  // The member's own last-active time; blank when the backend omits it.
  const lastActive =
    member.updatedAt === undefined ? "" : formatLastActive(member.updatedAt);

  return (
    <TableRow className="h-14">
      <TableCell className="text-foreground-primary px-6">
        <span className="flex min-w-0 items-center gap-2">
          <UserAvatar user={member} decorative size="xs" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{display}</span>
            {member.alias ? (
              <span className="text-foreground-tertiary truncate text-xs">
                {member.email}
              </span>
            ) : null}
          </span>
        </span>
      </TableCell>
      <TableCell className="px-6">
        {renderRoleCell({ isOwner, canManage, member, onChangeRole })}
      </TableCell>
      <TableCell className="text-foreground-secondary px-6 text-sm">
        {lastActive}
      </TableCell>
      <TableCell className="px-6 text-right">
        {/* The owner can't be removed or role-changed by anyone → no actions. */}
        {isOwner ? null : (
          <>
            {renderActionsMenu(canManage, () => setConfirmRemove(true))}
            {canManage ? (
              <ConfirmDialog
                open={confirmRemove}
                onOpenChange={setConfirmRemove}
                title="Remove member"
                body={`Remove "${display}" from this project. This can't be undone.`}
                onConfirm={onRemove}
                pending={removePending}
                confirmLabel="Remove"
                pendingLabel="Removing…"
              />
            ) : null}
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

// The ROLE column content: a read-only "Owner" for the project owner (fixed for
// everyone), an editable dropdown for an admin, or plain role text otherwise.
function renderRoleCell({
  isOwner,
  canManage,
  member,
  onChangeRole,
}: {
  isOwner: boolean;
  canManage: boolean;
  member: ProjectMember;
  onChangeRole: (next: RoleCode) => void;
}): React.JSX.Element {
  if (isOwner) {
    return <span className="text-foreground-secondary text-sm">Owner</span>;
  }
  if (canManage) {
    return renderRoleMenu(member.roleCode, onChangeRole);
  }
  return (
    <span className="text-foreground-secondary text-sm">
      {MEMBER_ROLE_LABELS[member.roleCode]}
    </span>
  );
}

// The admin role dropdown: current role as a link-styled trigger + a radio group
// of all roles.
function renderRoleMenu(
  roleCode: RoleCode,
  onChange: (next: RoleCode) => void,
): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="link"
            aria-label="Change role"
            className="text-foreground-secondary hover:text-foreground-primary h-auto gap-1 p-0 text-sm font-normal"
          />
        }
      >
        {MEMBER_ROLE_LABELS[roleCode]}
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="!w-40">
        <DropdownMenuRadioGroup
          value={roleCode}
          onValueChange={(v) => onChange(RoleCodeSchema.parse(v))}
        >
          {RoleCodeSchema.options.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} closeOnClick>
              {MEMBER_ROLE_LABELS[code]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The `···` actions menu. The trigger + menu open for everyone; the Remove item
// itself is gated — greyed with a reason tooltip for a non-admin.
function renderActionsMenu(
  canRemove: boolean,
  onRemove: () => void,
): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="subtle"
            size="icon-sm"
            aria-label="Member actions"
            className="text-foreground-secondary hover:text-foreground-primary shrink-0"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="!w-32">
        <GatedMenuItem
          allowed={canRemove}
          variant="destructive"
          onSelect={onRemove}
        >
          <Trash2 className="size-4" />
          Remove
        </GatedMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
