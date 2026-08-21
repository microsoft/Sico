import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { PROJECT_MEMBERS_QUERY_KEY } from "./use-project-members-query";
import { useApiClient } from "../../../services/api-client-context";
import { projectDetailQueryKey } from "../../projects/hooks/use-project-query";
import { type RoleCode, RoleCodeSchema } from "../../rbac/schemas/user-role";
import { assignUserRole } from "../../rbac/services/user-role";

export type InviteMemberInput = {
  userId: number;
  roleCode: RoleCode;
};

// Grant a project role to an existing user (the invite flow, after the email is
// resolved to a user via `findUserByEmail`). RBAC layers roles: `project_admin`
// sits ON TOP of a `project_member` base (see use-change-role-mutation), so an
// invite-as-admin must first establish the member base, THEN layer admin —
// two sequential grants. A member invite is a single grant. Invalidates the
// members query AND the project detail (the drawer's Team count reads
// `project.projectMembers`) so both refresh immediately.
export function useInviteMemberMutation(
  projectId: number,
): UseMutationResult<void, Error, InviteMemberInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, roleCode }: InviteMemberInput) => {
      const scope = { userId, scopeId: projectId, scopeType: "project" };
      // Admin = member base + admin overlay: assign the base first, then layer
      // admin on top. Order matters, so run them sequentially.
      if (roleCode === RoleCodeSchema.enum.project_admin) {
        await assignUserRole(apiClient, {
          ...scope,
          roleCode: RoleCodeSchema.enum.project_member,
        });
      }
      await assignUserRole(apiClient, { ...scope, roleCode });
    },
    // Fire-and-forget the invalidations (see use-remove-member-mutation): a
    // returned Promise.all keeps `isPending` true until the refetches resolve,
    // which would stick the invite dialog on a spinner after the grant landed.
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [PROJECT_MEMBERS_QUERY_KEY, projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: projectDetailQueryKey(projectId),
      });
    },
  });
}
