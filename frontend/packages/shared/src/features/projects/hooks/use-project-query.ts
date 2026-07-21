import {
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import type { ProjectDetail } from "../schemas/project";
import { fetchProjectDetail } from "../services/projects";

export function projectDetailQueryOptions(
  id: number,
  apiClient: AxiosInstance,
): {
  queryKey: readonly ["projects", "detail", number];
  queryFn: () => Promise<ProjectDetail>;
  staleTime: number;
} {
  return {
    queryKey: ["projects", "detail", id] as const,
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
