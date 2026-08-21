import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { projectDetailQueryKey } from "./use-project-query";
import { PROJECTS_LIST_QUERY_KEY } from "./use-projects-query";
import { useApiClient } from "../../../services/api-client-context";
import type { ProjectDetail } from "../schemas/project";
import { updateProject } from "../services/projects";

// The caller passes a PARTIAL edit and never owns `operatorAdmins`: the hook
// always sends the FULL operator set so a `{ name }`-only edit can't blank the
// operators (data-loss guard, §6 dec 6). An explicit `operatorAdmins` (the
// add/remove flows compute the next full set) overrides the cached injection.
type ProjectMutationVars = {
  name?: string;
  description?: string;
  iconUri?: string;
  operatorAdmins?: string[];
};

export function useProjectMutation(
  id: number,
): UseMutationResult<void, Error, ProjectMutationVars> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: ProjectMutationVars) => {
      const cached = queryClient.getQueryData<ProjectDetail>(
        projectDetailQueryKey(id),
      );
      const operatorAdmins =
        vars.operatorAdmins ?? cached?.operatorAdmins ?? [];
      return updateProject(apiClient, { ...vars, id, operatorAdmins });
    },
    // Refresh BOTH the drawer/detail (name, icon, operators) AND the project
    // cards in the list — an edit changes a project's list-card fields too, so a
    // detail-only invalidation would leave the list stale. Scoped to
    // `["projects","list"]` (not the whole `["projects"]` prefix) so the
    // project's asset/knowledge caches aren't needlessly refetched.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectDetailQueryKey(id) }),
        queryClient.invalidateQueries({
          queryKey: PROJECTS_LIST_QUERY_KEY,
          exact: false,
        }),
      ]),
  });
}
