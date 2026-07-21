import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  useSuspenseInfiniteQuery,
  type UseSuspenseInfiniteQueryOptions,
  type UseSuspenseInfiniteQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { type Paged } from "../../../schemas/paginated";
import { useApiClient } from "../../../services/api-client-context";
import {
  DEFAULT_PROJECT_MEMBER_TYPE,
  DEFAULT_PROJECT_PAGE_SIZE,
} from "../constants";
import { type MemberType, type Project } from "../schemas/project";
import { fetchProjects } from "../services/projects";

type Params = {
  memberType?: MemberType;
  pageSize?: number;
};

type ProjectsQueryKey = readonly [
  "projects",
  "list",
  { memberType: MemberType; pageSize: number },
];

type Options = UseSuspenseInfiniteQueryOptions<
  Paged<Project>,
  Error,
  InfiniteData<Paged<Project>>,
  ProjectsQueryKey,
  number
>;

export function projectsQueryOptions(
  params: Params,
  apiClient: AxiosInstance,
): Options {
  const memberType = params.memberType ?? DEFAULT_PROJECT_MEMBER_TYPE;
  const pageSize = params.pageSize ?? DEFAULT_PROJECT_PAGE_SIZE;
  return {
    queryKey: ["projects", "list", { memberType, pageSize }] as const,
    queryFn: ({ pageParam }): Promise<Paged<Project>> =>
      fetchProjects(apiClient, {
        page: pageParam,
        pageSize,
        memberType,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.hasNext ? lastPageParam + 1 : undefined,
    staleTime: 30_000,
    // Focus refetch drops already-loaded pages — bad UX for infinite scroll.
    refetchOnWindowFocus: false,
    gcTime: 5 * 60_000,
  };
}

export function useProjectsInfiniteQuery(
  params: Params = {},
): UseSuspenseInfiniteQueryResult<InfiniteData<Paged<Project>>> {
  const apiClient = useApiClient();
  return useSuspenseInfiniteQuery(projectsQueryOptions(params, apiClient));
}

/** Non-suspense variant — used where the component mounts outside the route's
 * Suspense boundary (e.g. the Add DW dialog) and renders its own inline
 * pending/error affordance, so a suspending query must not blank the page. */
export function useProjectsInfiniteQueryNonSuspense(
  params: Params = {},
): UseInfiniteQueryResult<InfiniteData<Paged<Project>>> {
  const apiClient = useApiClient();
  return useInfiniteQuery(projectsQueryOptions(params, apiClient));
}

export type { ProjectsQueryKey };
