import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { PROJECT_MEMBERS_QUERY_KEY } from "./use-project-members-query";
import { useApiClient } from "../../../services/api-client-context";
import { projectDetailQueryKey } from "../../projects/hooks/use-project-query";
import { type RoleCode, RoleCodeSchema } from "../../rbac/schemas/user-role";
import { removeUserRole } from "../../rbac/services/user-role";

export type RemoveMemberInput = {
  userId: number;
  roleCode: RoleCode;
};

// Remove a member from the project by revoking their role grant(s). Roles are
// ADDITIVE (see use-change-role / use-invite): an admin holds `project_member`
// as a base with `project_admin` layered on top, so fully removing an admin
// takes TWO deletes — the admin overlay first, then the member base. Removing
// only the deduped `roleCode` (project_admin) left the member base behind, so
// the "removed" user stayed in the project as a plain member. A plain member is
// a single delete. Invalidates the members query so the row disappears, the
// project detail (the drawer's Team count reads `project.projectMembers`), and
// the RBAC user-roles cache so a member who removes THEMSELVES loses their
// capability gates instead of reading a stale grant.
export function useRemoveMemberMutation(
  projectId: number,
): UseMutationResult<void, Error, RemoveMemberInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, roleCode }: RemoveMemberInput) => {
      const scope = { userId, scopeId: projectId, scopeType: "project" };
      // Admin = member base + admin overlay: peel the overlay first, then the
      // base. Order matters, so run them sequentially.
      if (roleCode === RoleCodeSchema.enum.project_admin) {
        await removeUserRole(apiClient, {
          ...scope,
          roleCode: RoleCodeSchema.enum.project_admin,
        });
        await removeUserRole(apiClient, {
          ...scope,
          roleCode: RoleCodeSchema.enum.project_member,
        });
        return;
      }
      await removeUserRole(apiClient, { ...scope, roleCode });
    },
    // Fire-and-forget the cache invalidations: returning the Promise.all would
    // make react-query keep `isPending` true until every refetch resolves, so a
    // slow role_users/user_roles refetch left the confirm dialog stuck on
    // "Removing…" long after the DELETE succeeded. `void` lets the mutation
    // settle immediately; the refetches update the list in the background.
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [PROJECT_MEMBERS_QUERY_KEY, projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: projectDetailQueryKey(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["rbac", "user-roles"],
        exact: false,
      });
    },
  });
}
