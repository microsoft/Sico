import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

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
): UseMutationResult<number, Error, ProjectMutationVars> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: ProjectMutationVars) => {
      const cached = queryClient.getQueryData<ProjectDetail>([
        "projects",
        "detail",
        id,
      ]);
      const operatorAdmins =
        vars.operatorAdmins ?? cached?.operatorAdmins ?? [];
      return updateProject(apiClient, { ...vars, id, operatorAdmins });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["projects", "detail", id],
      }),
  });
}
