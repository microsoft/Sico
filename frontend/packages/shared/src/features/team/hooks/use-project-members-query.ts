import {
  useQuery,
  type UseQueryResult,
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type ProjectMember } from "../schemas/member";
import { fetchProjectMembers } from "../services/members";

export const PROJECT_MEMBERS_QUERY_KEY = "project-members";

type MembersQueryKey = readonly ["project-members", number];

export function projectMembersQueryOptions(
  projectId: number,
  apiClient: AxiosInstance,
): UseSuspenseQueryOptions<
  ProjectMember[],
  Error,
  ProjectMember[],
  MembersQueryKey
> {
  return {
    queryKey: [PROJECT_MEMBERS_QUERY_KEY, projectId] as const,
    queryFn: (): Promise<ProjectMember[]> =>
      fetchProjectMembers(apiClient, projectId),
    staleTime: 30_000,
  };
}

/** Suspense variant — the members page renders inside a Suspense boundary. */
export function useProjectMembersSuspenseQuery(
  projectId: number,
): UseSuspenseQueryResult<ProjectMember[]> {
  const apiClient = useApiClient();
  return useSuspenseQuery(projectMembersQueryOptions(projectId, apiClient));
}

/** Non-suspense variant — used by the Reassign dialog's operator dropdown. */
export function useProjectMembersQuery(
  projectId: number,
): UseQueryResult<ProjectMember[]> {
  const apiClient = useApiClient();
  return useQuery(projectMembersQueryOptions(projectId, apiClient));
}
