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

// A Digital Worker's conversation list for the sidebar's conversation mode. A
// SUSPENSE infinite query: `ConversationModeMenu` wraps this in a local
// <Suspense> (skeleton rows) + <ErrorBoundary fallback={null}>, so the FIRST
// page shows the skeleton and a failed one degrades to nothing (logged, no
// user-facing error copy) without touching the rest of the sidebar. The backend
// filters by `agentInstanceId` server-side and orders newest-first; later pages
// fetch on demand (the sidebar list scrolls to a bottom sentinel — mirrors
// `use-history.ts`'s reverse pagination, minus the scroll-anchoring).
import {
  type InfiniteData,
  useSuspenseInfiniteQuery,
  type UseSuspenseInfiniteQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { useCallback } from "react";

import { useApiClient } from "../../../services/api-client-context";
import { type ConversationSummary } from "../schemas/conversation";
import {
  type ConversationListPage,
  listConversations,
} from "../services/conversation";

type ConversationListQueryKey = readonly [
  "conversations",
  "list",
  { agentInstanceId: number },
];

type Options = UseSuspenseInfiniteQueryOptions<
  ConversationListPage,
  Error,
  InfiniteData<ConversationListPage>,
  ConversationListQueryKey,
  number
>;

export function conversationListQueryOptions(
  agentInstanceId: number,
  apiClient: AxiosInstance,
): Options {
  return {
    queryKey: ["conversations", "list", { agentInstanceId }] as const,
    queryFn: ({ pageParam }): Promise<ConversationListPage> =>
      listConversations(apiClient, agentInstanceId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.hasNext ? lastPageParam + 1 : undefined,
    // The list is invalidated explicitly on create (use-create-conversation),
    // so a short stale window is fine and avoids a focus-refetch flicker.
    staleTime: 30_000,
    // Focus refetch drops already-loaded pages — bad UX for infinite scroll.
    refetchOnWindowFocus: false,
    gcTime: 5 * 60_000,
  };
}

export type UseConversations = {
  // Newest-first, flattened across every loaded page (backend page order).
  items: ConversationSummary[];
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
};

export function useConversations(agentInstanceId: number): UseConversations {
  const apiClient = useApiClient();
  const query = useSuspenseInfiniteQuery(
    conversationListQueryOptions(agentInstanceId, apiClient),
  );
  // `fetchNextPage` is a stable react-query ref, so wrapping keeps this handle
  // stable across renders (mirrors use-history's `fetchOlder`) — it flows into
  // useInfiniteScrollSentinel's effect deps.
  const { fetchNextPage } = query;
  const fetchNext = useCallback((): void => {
    void fetchNextPage();
  }, [fetchNextPage]);
  return {
    items: query.data.pages.flatMap((page) => page.items),
    hasNextPage: query.hasNextPage,
    fetchNextPage: fetchNext,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}
