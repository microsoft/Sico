import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "../../../services/api-client-context";
import { createProject } from "../services/projects";

type CreateProjectVars = {
  name: string;
  description?: string;
  // Cover URL (`uri` from a prior asset upload). Forwarded to `createProject`
  // as the project's `iconUri`.
  iconUri?: string;
};

// Invalidate the `["projects"]` prefix so the new project refreshes the list and
// any detail view without a manual reload (matches the DW-create hook's key).
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
        queryKey: ["projects"],
        exact: false,
      }),
  });
}
