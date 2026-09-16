import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "../../../services/api-client-context";
import { projectKeys } from "../query-keys";
import { createProject } from "../services/projects";

type CreateProjectVars = {
  name: string;
  organizationId: number;
  description?: string;
  // Cover URL (`uri` from a prior asset upload). Forwarded to `createProject`
  // as the project's `iconUri`.
  iconUri?: string;
};

// Invalidate every project-list variant so the new project appears without
// staling unrelated project detail or asset caches.
export function useCreateProjectMutation(): UseMutationResult<
  number,
  Error,
  CreateProjectVars
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateProjectVars) => createProject(apiClient, vars),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: projectKeys.lists(),
        exact: false,
      }),
  });
}
