import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { PROJECT_MEMBERS_QUERY_KEY } from "./use-project-members-query";
import { useApiClient } from "../../../services/api-client-context";
import { projectDetailQueryKey } from "../../projects/hooks/use-project-query";
import { type RoleCode, RoleCodeSchema } from "../../rbac/schemas/user-role";
import { assignUserRole, removeUserRole } from "../../rbac/services/user-role";
import { type ProjectMember } from "../schemas/member";

export type ChangeRoleInput = {
  userId: number;
  toRoleCode: RoleCode;
};

// Additive-model role change (see the hook doc): promote → ASSIGN project_admin
// atop the member base; demote → REMOVE project_admin to uncover it. One call.
function applyRoleChange(
  apiClient: AxiosInstance,
  projectId: number,
  { userId, toRoleCode }: ChangeRoleInput,
): Promise<void> {
  const scope = {
    userId,
    scopeId: projectId,
    scopeType: "project",
    roleCode: RoleCodeSchema.enum.project_admin,
  };
  return toRoleCode === RoleCodeSchema.enum.project_admin
    ? assignUserRole(apiClient, scope)
    : removeUserRole(apiClient, scope);
}

// Change a member's project role with a SINGLE call. Roles are ADDITIVE — every
// member holds `project_member` as a base, and `project_admin` is layered on
// top — so switching is one grant, never a swap:
//   - to admin  → ASSIGN project_admin (the member base stays underneath)
//   - to member → REMOVE project_admin (uncovers the member base)
// Updates the list OPTIMISTICALLY so the dropdown check jumps immediately;
// `onSettled` reconciles against the server and invalidates the RBAC user-roles
// cache so a member who changes THEIR OWN role sees their capability gates
// (edit/invite/…) update rather than reading a stale grant.
export function useChangeRoleMutation(
  projectId: number,
): UseMutationResult<
  void,
  Error,
  ChangeRoleInput,
  { previous: ProjectMember[] | undefined }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const queryKey = [PROJECT_MEMBERS_QUERY_KEY, projectId] as const;
  return useMutation({
    mutationFn: (input: ChangeRoleInput) =>
      applyRoleChange(apiClient, projectId, input),
    onMutate: async ({ userId, toRoleCode }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ProjectMember[]>(queryKey);
      queryClient.setQueryData<ProjectMember[]>(queryKey, (members) =>
        members?.map((member) =>
          member.id === userId ? { ...member, roleCode: toRoleCode } : member,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: projectDetailQueryKey(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["rbac", "user-roles"],
          exact: false,
        }),
      ]),
  });
}
