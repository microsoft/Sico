import {
  useQuery,
  type UseQueryResult,
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type SingleAgentCard } from "../schemas/single-agent-card";
import { fetchAgentInfos } from "../services/single-agents";

export const AGENT_INFOS_QUERY_KEY_PREFIX = "studio-agent-infos";

type AgentInfosQueryKey = readonly ["studio-agent-infos"];

export function agentInfosQueryOptions(
  apiClient: AxiosInstance,
): UseSuspenseQueryOptions<
  SingleAgentCard[],
  Error,
  SingleAgentCard[],
  AgentInfosQueryKey
> {
  return {
    queryKey: [AGENT_INFOS_QUERY_KEY_PREFIX] as const,
    queryFn: (): Promise<SingleAgentCard[]> => fetchAgentInfos(apiClient),
  };
}

export function useAgentInfosQuery(): UseQueryResult<SingleAgentCard[]> {
  const apiClient = useApiClient();
  return useQuery(agentInfosQueryOptions(apiClient));
}

export function useAgentInfosSuspenseQuery(): UseSuspenseQueryResult<
  SingleAgentCard[]
> {
  const apiClient = useApiClient();
  return useSuspenseQuery(agentInfosQueryOptions(apiClient));
}
