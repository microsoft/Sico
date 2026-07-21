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
