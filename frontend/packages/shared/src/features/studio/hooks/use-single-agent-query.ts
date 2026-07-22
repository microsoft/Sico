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
