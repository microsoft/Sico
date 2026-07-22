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

// Onboarding suggested tasks for the empty-state Digital Worker home. A
// SUSPENSE query: the home page wraps ONLY the suggested-tasks area in a local
// <Suspense> (skeleton fallback) + <ErrorBoundary fallback={null}>, so the
// hero + composer render immediately and a failed fetch degrades to "no
// suggestions" rather than blanking the page.
import {
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type RecommendationTask } from "../schemas/recommendation-task";
import { fetchRecommendationTasks } from "../services/recommendation";

type RecommendationQueryKey = readonly [
  "recommendation-tasks",
  { agentInstanceId: number },
];

export function recommendationTasksQueryOptions(
  agentInstanceId: number,
  apiClient: AxiosInstance,
): UseSuspenseQueryOptions<
  RecommendationTask[],
  Error,
  RecommendationTask[],
  RecommendationQueryKey
> {
  return {
    queryKey: ["recommendation-tasks", { agentInstanceId }] as const,
    // A thrown fetch (network / off-contract body) surfaces to the home's local
    // <ErrorBoundary fallback={null}>, degrading to "no suggestions" without
    // blanking the hero + composer. react-query records the error state.
    queryFn: (): Promise<RecommendationTask[]> =>
      fetchRecommendationTasks(apiClient, agentInstanceId),
    // Onboarding suggestions are stable for a session; don't refetch on focus.
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    // One shot — a failed suggestion fetch surfaces to the boundary, no retry
    // storm.
    retry: false,
  };
}

export function useSuspenseRecommendationTasks(
  agentInstanceId: number,
): RecommendationTask[] {
  const apiClient = useApiClient();
  return useSuspenseQuery(
    recommendationTasksQueryOptions(agentInstanceId, apiClient),
  ).data;
}
