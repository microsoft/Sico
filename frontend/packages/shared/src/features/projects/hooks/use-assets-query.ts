import {
  type InfiniteData,
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
  type UseSuspenseInfiniteQueryOptions,
  type UseSuspenseInfiniteQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { useCallback } from "react";

import { type Paged } from "../../../schemas/paginated";
import { useApiClient } from "../../../services/api-client-context";
import { assertNever } from "../../../utils/assert-never";
import {
  fetchDeliverables,
  fetchDocuments,
  fetchKnowledgeItems,
  fetchPlaybooks,
} from "../services/assets";
import type { AssetCategory, AssetRow } from "../types";

const ASSETS_PAGE_SIZE = 30;

// Resolve the category to its list fetcher. Each fetcher already returns
// `Paged<AssetRow>` (the wire→client mapping lives in the service layer's
// envelope transforms), so the hook never touches wire shapes. Every category
// is handled explicitly so a future 5th `AssetCategory` is a compile error
// (`assertNever`), not a silent route to the `all` endpoint.
function fetchAssetPage(
  apiClient: AxiosInstance,
  category: AssetCategory,
  projectId: number,
  page: number,
): Promise<Paged<AssetRow>> {
  const params = { projectId, page, pageSize: ASSETS_PAGE_SIZE };
  switch (category) {
    case "all":
      return fetchKnowledgeItems(apiClient, params);
    case "knowledge":
      return fetchDocuments(apiClient, params);
    case "deliverable":
      return fetchDeliverables(apiClient, params);
    case "experience":
      return fetchPlaybooks(apiClient, params);
    default:
      return assertNever(category);
  }
}

export type AssetsQueryKey = readonly [
  "projects",
  "assets",
  number,
  AssetCategory,
];

// The query key for one category's asset list — exported so the poll hook and
// route loaders address the exact same cache entry.
export function assetsQueryKey(
  projectId: number,
  category: AssetCategory,
): AssetsQueryKey {
  return ["projects", "assets", projectId, category] as const;
}

// One shared options factory for the per-category asset list — consumed by the
// SUSPENSE hook (the table rows + route `loader` prefetch) and the non-suspense
// hook (the table shell's sentinel data source). Both go through this so they
// hit the SAME cache entry (mirrors `agentsQueryOptions`' dual-surface model).
// NOTE: no `refetchInterval` here — the 5s extraction poll lives in
// `useAssetsPoll`, which invalidates this key, so it isn't duplicated per
// observer.
export function assetsInfiniteQueryOptions(
  projectId: number,
  category: AssetCategory,
  apiClient: AxiosInstance,
): UseSuspenseInfiniteQueryOptions<
  Paged<AssetRow>,
  Error,
  InfiniteData<Paged<AssetRow>>,
  AssetsQueryKey,
  number
> {
  return {
    queryKey: assetsQueryKey(projectId, category),
    queryFn: ({ pageParam }): Promise<Paged<AssetRow>> =>
      fetchAssetPage(apiClient, category, projectId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _all, lastParam): number | undefined =>
      lastPage.hasNext ? lastParam + 1 : undefined,
    staleTime: 30_000,
    // Focus refetch would drop already-loaded pages — bad UX for infinite scroll.
    refetchOnWindowFocus: false,
    gcTime: 5 * 60_000,
  };
}

// SUSPENSE variant — the table ROWS read this so a cold load suspends to the
// `<Suspense>` fallback and an error throws to the local `<ErrorBoundary>` (the
// route-prefetched cache means it usually resolves without suspending).
export function useSuspenseAssetsInfiniteQuery(
  projectId: number,
  category: AssetCategory,
): UseSuspenseInfiniteQueryResult<InfiniteData<Paged<AssetRow>>> {
  const apiClient = useApiClient();
  return useSuspenseInfiniteQuery(
    assetsInfiniteQueryOptions(projectId, category, apiClient),
  );
}

export type UseAssetsQueryResult = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
};

// NON-suspense variant — the table SHELL reads this purely for the infinite-
// scroll sentinel's pagination state (`hasNextPage` / `isFetchingNextPage` /
// `fetchNextPage`). It NEVER suspends, so the toolbar + scroll card + sentinel
// stay mounted across query states (the C1/C2 fix). It shares the same cache
// entry as the suspense hook above, so no extra request is made.
export function useAssetsInfiniteQuery(
  projectId: number,
  category: AssetCategory,
): UseAssetsQueryResult {
  const apiClient = useApiClient();
  const query = useInfiniteQuery(
    assetsInfiniteQueryOptions(projectId, category, apiClient),
  );

  // Stable identity so the sentinel hook's effect doesn't re-run every render.
  // `query.fetchNextPage` is itself referentially stable across renders.
  const { fetchNextPage: queryFetchNextPage } = query;
  const fetchNextPage = useCallback(() => {
    void queryFetchNextPage();
  }, [queryFetchNextPage]);

  return {
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage,
  };
}
