import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "../../../services/api-client-context";
import { deleteProject } from "../services/projects";

// Delete a project. Invalidate the `["projects"]` prefix so the deleted card
// drops from the list; navigation away from the deleted project is owned by the
// caller (the workspace), not this hook.
export function useDeleteProjectMutation(
  projectId: number,
): UseMutationResult<void, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteProject(apiClient, projectId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["projects"], exact: false }),
  });
}
