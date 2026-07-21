import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { AGENTS_QUERY_KEY_PREFIX } from "./use-agents-query";
import { useApiClient } from "../../../services/api-client-context";
import {
  createAgentInstance,
  type CreateAgentInstanceInput,
  type CreatedAgentInstance,
} from "../services/agents";

// Invalidate `["agents", "list"]` (the /digital-worker grid) AND `["projects"]`
// (the project list cards' avatar group + the /project/:id detail DW list) so a
// newly-created instance shows up immediately on every surface — the project
// queries have a 30s staleTime + no focus refetch, so without this the project
// pages keep stale data until a hard reload.
export function useCreateAgentInstanceMutation(): UseMutationResult<
  CreatedAgentInstance,
  Error,
  CreateAgentInstanceInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInstanceInput) =>
      createAgentInstance(apiClient, input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: AGENTS_QUERY_KEY_PREFIX,
          exact: false,
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects"],
          exact: false,
        }),
      ]),
  });
}
