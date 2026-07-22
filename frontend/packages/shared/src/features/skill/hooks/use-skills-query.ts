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
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  useQuery,
  type UseQueryResult,
  useSuspenseInfiniteQuery,
  type UseSuspenseInfiniteQueryOptions,
  type UseSuspenseInfiniteQueryResult,
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { type Paged } from "../../../schemas/paginated";
import { useApiClient } from "../../../services/api-client-context";
import { type SkillItem } from "../schemas/skill";
import { fetchSkills, type SkillsParams } from "../services/skills";

export const SKILLS_QUERY_KEY_PREFIX = "skills";

type SkillsQueryKey = readonly ["skills", SkillsParams];

export function skillsQueryOptions(
  apiClient: AxiosInstance,
  params: SkillsParams,
): UseSuspenseQueryOptions<
  Paged<SkillItem>,
  Error,
  Paged<SkillItem>,
  SkillsQueryKey
> {
  return {
    queryKey: [SKILLS_QUERY_KEY_PREFIX, params] as const,
    queryFn: (): Promise<Paged<SkillItem>> => fetchSkills(apiClient, params),
  };
}

export function useSkillsQuery(
  params: SkillsParams,
  options?: { enabled?: boolean },
): UseQueryResult<Paged<SkillItem>> {
  const apiClient = useApiClient();
  return useQuery({
    ...skillsQueryOptions(apiClient, params),
    enabled: options?.enabled,
  });
}

export function useSkillsSuspenseQuery(
  params: SkillsParams,
): UseSuspenseQueryResult<Paged<SkillItem>> {
  const apiClient = useApiClient();
  return useSuspenseQuery(skillsQueryOptions(apiClient, params));
}

type SkillsInfiniteParams = Omit<SkillsParams, "page">;

type SkillsInfiniteQueryKey = readonly [
  "skills",
  "infinite",
  SkillsInfiniteParams,
];

export function skillsInfiniteQueryOptions(
  apiClient: AxiosInstance,
  params: SkillsInfiniteParams,
): UseSuspenseInfiniteQueryOptions<
  Paged<SkillItem>,
  Error,
  InfiniteData<Paged<SkillItem>>,
  SkillsInfiniteQueryKey,
  number
> {
  return {
    queryKey: [SKILLS_QUERY_KEY_PREFIX, "infinite", params] as const,
    queryFn: ({
      pageParam,
    }: {
      pageParam: number;
    }): Promise<Paged<SkillItem>> =>
      fetchSkills(apiClient, { ...params, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (
      lastPage: Paged<SkillItem>,
      _allPages: unknown,
      lastPageParam: number,
    ) => (lastPage.hasNext ? lastPageParam + 1 : undefined),
    // 30s stale window so the route loader's prefetch satisfies the page-level
    // suspense gate and the section without a duplicate refetch on subscribe.
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  };
}

// Infinite-scroll variant used by the setup SKILL section, mirroring the
// digital-worker grid. Shares the SKILLS prefix so status-sync invalidations
// still drop its cache.
export function useSkillsInfiniteQuery(
  params: SkillsInfiniteParams,
  options?: { enabled?: boolean },
): UseInfiniteQueryResult<InfiniteData<Paged<SkillItem>>> {
  const apiClient = useApiClient();
  return useInfiniteQuery({
    ...skillsInfiniteQueryOptions(apiClient, params),
    enabled: options?.enabled,
  });
}

// Suspense sibling of `useSkillsInfiniteQuery` — same key, so the setup body
// can gate the page skeleton on the first page before the section reads it
// from cache. Only initial load suspends; subsequent pages do not.
export function useSkillsSuspenseInfiniteQuery(
  params: SkillsInfiniteParams,
): UseSuspenseInfiniteQueryResult<InfiniteData<Paged<SkillItem>>> {
  const apiClient = useApiClient();
  return useSuspenseInfiniteQuery(
    skillsInfiniteQueryOptions(apiClient, params),
  );
}
