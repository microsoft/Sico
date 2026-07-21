import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { AGENT_INFOS_QUERY_KEY_PREFIX } from "./use-agent-infos-query";
import { SINGLE_AGENT_QUERY_KEY_PREFIX } from "./use-single-agent-query";
import { useApiClient } from "../../../services/api-client-context";
import {
  createSingleAgent,
  type CreateSingleAgentInput,
  type CreateSingleAgentResult,
  deploySingleAgent,
  type DeploySingleAgentInput,
  type DeploySingleAgentResult,
  updateSingleAgent,
  type UpdateSingleAgentInput,
} from "../services/single-agent-mutations";

// Create/update invalidate the Studio list (single_agent_infos) so a new or
// renamed worker shows up without a manual refetch. Update also invalidates the
// agent's own single_agent detail so the setup page's Basic Info (and the
// deploy name) reflect the save — mirroring the legacy re-fetch-after-save.
// Deploy targets the instance backend and has no list to invalidate here — the
// caller navigates to Collaboration on success.

export function useCreateSingleAgentMutation(): UseMutationResult<
  CreateSingleAgentResult,
  Error,
  CreateSingleAgentInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSingleAgentInput) =>
      createSingleAgent(apiClient, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [AGENT_INFOS_QUERY_KEY_PREFIX],
      }),
  });
}

export function useUpdateSingleAgentMutation(): UseMutationResult<
  void,
  Error,
  UpdateSingleAgentInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSingleAgentInput) =>
      updateSingleAgent(apiClient, input),
    onSuccess: (_data, { agentId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: [AGENT_INFOS_QUERY_KEY_PREFIX],
        }),
        queryClient.invalidateQueries({
          queryKey: [SINGLE_AGENT_QUERY_KEY_PREFIX, agentId],
        }),
      ]),
  });
}

export function useDeploySingleAgentMutation(): UseMutationResult<
  DeploySingleAgentResult,
  Error,
  DeploySingleAgentInput
> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (input: DeploySingleAgentInput) =>
      deploySingleAgent(apiClient, input),
  });
}
