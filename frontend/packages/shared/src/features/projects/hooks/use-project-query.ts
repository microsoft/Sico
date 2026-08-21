import {
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import type { ProjectDetail } from "../schemas/project";
import { fetchProjectDetail } from "../services/projects";

// The project-detail cache key. Shared so mutations that change data the detail
// endpoint embeds (member roster, sandboxes) can invalidate it precisely.
export function projectDetailQueryKey(
  id: number,
): readonly ["projects", "detail", number] {
  return ["projects", "detail", id] as const;
}

export function projectDetailQueryOptions(
  id: number,
  apiClient: AxiosInstance,
): {
  queryKey: readonly ["projects", "detail", number];
  queryFn: () => Promise<ProjectDetail>;
  staleTime: number;
} {
  return {
    queryKey: projectDetailQueryKey(id),
    queryFn: (): Promise<ProjectDetail> => fetchProjectDetail(apiClient, id),
    staleTime: 30_000,
  };
}

export function useProjectDetailQuery(
  id: number,
): UseSuspenseQueryResult<ProjectDetail> {
  const apiClient = useApiClient();
  return useSuspenseQuery(projectDetailQueryOptions(id, apiClient));
}
