import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { AGENTS_QUERY_KEY_PREFIX } from "./use-agents-query";
import { useApiClient } from "../../../services/api-client-context";
import { dismissAgentInstance } from "../services/agents";

// Dismiss a digital worker from its project. Invalidates the agents list AND
// the projects list (the project detail's DW group) so the card disappears
// everywhere — mirrors `useCreateAgentInstanceMutation`'s dual invalidation.
export function useDismissAgentMutation(): UseMutationResult<
  void,
  Error,
  { id: number }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      dismissAgentInstance(apiClient, { id }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: AGENTS_QUERY_KEY_PREFIX,
          exact: false,
        }),
        queryClient.invalidateQueries({ queryKey: ["projects"], exact: false }),
      ]),
  });
}
