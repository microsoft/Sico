import { toast } from "@sico/ui";
import { useState } from "react";

import { useChangeRoleMutation } from "./use-change-role-mutation";
import { useRemoveMemberMutation } from "./use-remove-member-mutation";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { type RoleCode } from "../../rbac/schemas/user-role";
import { type ProjectMember } from "../schemas/member";

export type MemberRowActions = {
  /** Remove-confirm dialog visibility (opened from the Remove menu item). */
  confirmRemove: boolean;
  setConfirmRemove: (open: boolean) => void;
  /** Changes the member's role; no-ops when the role is unchanged. */
  onChangeRole: (next: RoleCode) => void;
  /** Fires the remove mutation; toasts + closes the dialog on success. */
  onRemove: () => void;
  removePending: boolean;
};

// The role-change + remove flows for one Humans-table row: owns the confirm
// dialog state and both mutations, so `HumanRow` stays presentational and the
// table file holds no per-row hook logic.
export function useMemberRowActions(
  projectId: number,
  member: ProjectMember,
): MemberRowActions {
  const changeRole = useChangeRoleMutation(projectId);
  const removeMember = useRemoveMemberMutation(projectId);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const onChangeRole = (next: RoleCode): void => {
    if (next === member.roleCode) {
      return;
    }
    changeRole.mutate(
      { userId: member.id, toRoleCode: next },
      {
        onSuccess: () => toast.success("Role updated.", { invert: true }),
        onError: (error) =>
          toast.error(apiErrorMessage(error, "We couldn't change the role.")),
      },
    );
  };

  const onRemove = (): void => {
    removeMember.mutate(
      { userId: member.id, roleCode: member.roleCode },
      {
        onSuccess: () => {
          toast.success("Member removed.", { invert: true });
          setConfirmRemove(false);
        },
        onError: (error) =>
          toast.error(apiErrorMessage(error, "We couldn't remove the member.")),
      },
    );
  };

  return {
    confirmRemove,
    setConfirmRemove,
    onChangeRole,
    onRemove,
    removePending: removeMember.isPending,
  };
}
