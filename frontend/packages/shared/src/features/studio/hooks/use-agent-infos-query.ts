/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
