import {
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type SingleAgentDetail } from "../schemas/single-agent";
import { fetchSingleAgent } from "../services/single-agents";

export const SINGLE_AGENT_QUERY_KEY_PREFIX = "studio-single-agent";

type SingleAgentQueryKey = readonly ["studio-single-agent", string];

export function singleAgentQueryOptions(
  apiClient: AxiosInstance,
  agentId: string,
): UseSuspenseQueryOptions<
  SingleAgentDetail,
  Error,
  SingleAgentDetail,
  SingleAgentQueryKey
> {
  return {
    queryKey: [SINGLE_AGENT_QUERY_KEY_PREFIX, agentId] as const,
    queryFn: (): Promise<SingleAgentDetail> =>
      fetchSingleAgent(apiClient, agentId),
    // 30s stale window so the route loader's prefetch satisfies the component
    // mount without a duplicate refetch (default staleTime of 0 would refetch
    // immediately on subscribe).
    staleTime: 30_000,
  };
}

export function useSingleAgentSuspenseQuery(
  agentId: string,
): UseSuspenseQueryResult<SingleAgentDetail> {
  const apiClient = useApiClient();
  return useSuspenseQuery(singleAgentQueryOptions(apiClient, agentId));
}
