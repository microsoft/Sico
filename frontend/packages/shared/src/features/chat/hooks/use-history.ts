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

// Studio-mode history hook. TanStack Query owns fetch/cache/dedup ONLY; the
// jotai `conversationsAtom` is the sole render source-of-truth — this hook
// fetches newest-first pages and HYDRATES the atom, never rendering from
// `query.data`. NON-suspense (`useInfiniteQuery`): it never suspends or throws,
// so the message list (which reads the store) stays mounted across loading /
// error — a history-fetch failure surfaces as a toast + log, NOT a panel-
// replacing error screen that would hide the user's just-sent message.
import { toast } from "@sico/ui";
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  type UseInfiniteQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { produce } from "immer";
import { type createStore, useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { useApiClient } from "../../../services/api-client-context";
import { useSicoConfig } from "../../../services/sico-config-context";
import { makeId } from "../../../utils/id";
import { logger } from "../../../utils/logger";
import {
  activeConversationIdAtom,
  type Conversation,
  conversationsAtom,
  createFirstConversationIdsAtom,
  type Message,
  plansAtom,
} from "../atoms/chat-atom";
import { type Plan } from "../schemas/plan";
import { resolveChatEndpoints } from "../services/chat-endpoints";
import { fetchHistory, type HistoryPage } from "../services/history";
import { groupTurns } from "../utils/group-turns";

type Store = ReturnType<typeof createStore>;

// Keyed on `agentInstanceId` + `conversationId`. `messagesPath` is a
// deploy-time constant (sico vs dwp are separate builds with separate
// QueryClients), so it never varies within a runtime and can't collide — keying
// on it would isolate a cache entry that can never exist. `conversationId`
// (dwp multi-conversation) DOES vary per active conversation, so it keys the
// cache — sico (v1) passes `undefined` and gets a single stable entry.
type HistoryQueryKey = readonly [
  "history",
  "messages",
  { agentInstanceId: number; conversationId: number | undefined },
];

// The single source of truth for the history cache key. Both the fetch
// (`historyQueryOptions`) and the create-first seed (`seedEmptyHistory`) build
// their key here, so a seed and its later read can never drift apart — a
// mismatch would silently miss the cache and regress the no-skeleton-flash
// guarantee with no error and no test failure.
function historyQueryKey(
  agentInstanceId: number,
  conversationId?: number,
): HistoryQueryKey {
  return ["history", "messages", { agentInstanceId, conversationId }] as const;
}

// Typed for the NON-suspense `useInfiniteQuery` this hook actually calls (the
// base options type), not the suspense variant — the two share one cache entry,
// but using the base type keeps the option set honest (e.g. a future `enabled`
// gate would type-check here).
type Options = UseInfiniteQueryOptions<
  HistoryPage,
  Error,
  InfiniteData<HistoryPage>,
  HistoryQueryKey,
  number
>;

export type UseHistory = {
  // True while the FIRST page is loading and nothing is cached yet — the loading
  // gate shows a skeleton only when this is true AND the store is empty.
  isPending: boolean;
  hasMore: boolean;
  fetchOlder: () => void;
  isFetchingOlder: boolean;
};

export function historyQueryOptions(
  agentInstanceId: number,
  apiClient: AxiosInstance,
  messagesPath: string,
  conversationId?: number,
): Options {
  return {
    queryKey: historyQueryKey(agentInstanceId, conversationId),
    queryFn: ({ pageParam }): Promise<HistoryPage> =>
      fetchHistory(apiClient, {
        agentInstanceId,
        conversationId,
        page: pageParam,
        messagesPath,
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

// Prime the history cache with an empty first page for a brand-new conversation
// so `MessageHistory`'s non-suspense `useInfiniteQuery` reports `isPending=false`
// on mount (cached data present). The create-first home flow calls this before
// navigating into the chat: with `isPending` already false, the `isPending &&
// isEmpty` skeleton gate is skipped and the parked message is drained + rendered
// by ONE `MessageList` instance (no skeleton → real-list swap, so no flash).
// Builds the key via `historyQueryKey`, the same builder the read uses, so seed
// and read can't drift.
//
// Seeded as immediately STALE (`updatedAt: 0`), NOT fresh: the seed's only job
// is to skip the FIRST-mount skeleton flash. Messages sent after seeding are
// written to the jotai store only (never back into this history cache), and
// Collaboration's mount resets that store — so a later remount (navigate to
// another conversation and back) must REFETCH real server history instead of
// re-serving this empty page. A fresh seed (default `updatedAt: now`) would stay
// fresh for `staleTime` (30s) and, with `refetchOnMount` skipping the refetch,
// render the just-used conversation empty. `updatedAt: 0` makes it stale so
// `refetchOnMount` (default true) refetches on the next mount, while the first
// mount still reads the cached page synchronously (no flash).
export function seedEmptyHistory(
  queryClient: QueryClient,
  agentInstanceId: number,
  conversationId: number,
): void {
  const key = historyQueryKey(agentInstanceId, conversationId);
  // Only seed when nothing is cached — never clobber real fetched history.
  if (queryClient.getQueryData(key) !== undefined) {
    return;
  }
  const seed: InfiniteData<HistoryPage, number> = {
    pages: [{ items: [], hasNext: false }],
    pageParams: [1],
  };
  queryClient.setQueryData(key, seed, { updatedAt: 0 });
}

// Invalidate a conversation's history cache — call when a turn SETTLES
// (`done`/`error`), by which point the message is persisted server-side. The
// create-first seed leaves the history cache empty and nothing writes sent
// messages back into it, so without this a revisit within `staleTime` would
// re-serve the empty page and render the just-used conversation blank.
//
// `refetchType: "none"` marks the key stale WITHOUT refetching the live
// observer: the goal is only that the NEXT mount refetches the now-persisted
// turn. Letting the active observer refetch here would re-hydrate the live view
// from server rows whose ids are numeric — swapping the optimistic UUID ids the
// store already renders. That id churn remounts the just-settled `MessageCard`
// (keyed on `message.id`) and re-fires the new-human-to-top scroll anchor
// (keyed on the tail id), a visible flash + scroll jump on every turn; it can
// also race server persistence and re-freshen the cache empty. The live view
// needs no refetch — the store already holds the settled turn. Uses the same
// `historyQueryKey` builder as the seed + read, so it can't target the wrong slot.
export function invalidateHistory(
  queryClient: QueryClient,
  agentInstanceId: number,
  conversationId?: number,
): void {
  void queryClient.invalidateQueries({
    queryKey: historyQueryKey(agentInstanceId, conversationId),
    refetchType: "none",
  });
}

// Flatten newest-first pages, dedup by id keeping the FIRST occurrence (newest
// wins on overlap), then reverse to oldest→newest for render order.
function toOldestFirst(pages: HistoryPage[]): Message[] {
  const seen = new Set<string>();
  const deduped: Message[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        deduped.push(item);
      }
    }
  }
  deduped.reverse();
  return deduped;
}

// Merge historical messages into the conversation, preserving references (immer
// structural sharing) so unchanged rows keep object identity, and keep the live
// tail at the bottom. Dedup by BOTH id AND turnId: a turn that was streaming
// when the page reloaded gets persisted with a backend numeric id, while the
// resumed live copy still carries a client UUID — same turn, different id. So a
// live row whose turnId already appears in `historical` is the SAME message and
// must be dropped (historical is the authoritative persisted version), else it
// renders twice. A live row with NO turnId (a fresh send not yet acknowledged)
// is always kept — it hasn't claimed a turn yet. (Mirrors legacy's
// `new Set(turnId)` grouping in ConversationSectionAdapter.)
function mergeHistory(draft: Conversation, historical: Message[]): void {
  const existingById = new Map(
    draft.history.map((m): [string, Message] => [m.id, m]),
  );
  const histIds = new Set(historical.map((m) => m.id));
  const histTurnIds = new Set(
    historical.map((m) => m.turnId).filter((t): t is number => t !== undefined),
  );
  const mergedHistorical = historical.map((m) => existingById.get(m.id) ?? m);
  const live = draft.history.filter(
    (m) =>
      !histIds.has(m.id) &&
      (m.turnId === undefined || !histTurnIds.has(m.turnId)),
  );
  draft.history = [...mergedHistorical, ...live];
}

// Seed `plansAtom` from the inline plans carried on hydrated history messages.
// Seed-IF-ABSENT: a live poll (use-plan) is the authoritative writer, so a plan
// already in the Map is never overwritten by a (possibly older) history seed.
// Returns the same Map ref when nothing was added, so the store write is skipped.
function seedPlans(
  prev: Map<string, Plan>,
  messages: Message[],
): Map<string, Plan> {
  let next: Map<string, Plan> | undefined;
  for (const msg of messages) {
    if (msg.seedPlan !== undefined && !prev.has(msg.seedPlan.planId)) {
      next ??= new Map(prev);
      next.set(msg.seedPlan.planId, msg.seedPlan);
    }
  }
  return next ?? prev;
}

// Reuse the active conversation or mint one and make it active. When a server
// `conversationId` is known (dwp multi-conversation), the client id IS
// `String(conversationId)` — a stable, addressable key shared with the route,
// send path, and sidebar list — find-or-create under it. Without one (sico v1),
// fall back to the active slot or a minted UUID (single implicit conversation).
function ensureConversationForServerId(
  store: Store,
  conversationId: number | undefined,
): string {
  if (conversationId !== undefined) {
    const id = String(conversationId);
    const existing = store.get(conversationsAtom).get(id);
    if (existing === undefined) {
      store.set(
        conversationsAtom,
        produce(store.get(conversationsAtom), (map) => {
          map.set(id, { clientId: id, conversationId, history: [] });
        }),
      );
    }
    store.set(activeConversationIdAtom, id);
    return id;
  }
  const active = store.get(activeConversationIdAtom);
  if (active !== null) {
    return active;
  }
  const id = makeId();
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (map) => {
      map.set(id, { clientId: id, history: [] });
    }),
  );
  store.set(activeConversationIdAtom, id);
  return id;
}

// Hydrate the store from cached pages. Keyed on `data` (react-query keeps a
// stable ref when unchanged) so this runs only when a page is added. `data` is
// `undefined` before the first page resolves (non-suspense), so guard it.
function useHydrateHistory(
  store: Store,
  data: InfiniteData<HistoryPage> | undefined,
  conversationId: number | undefined,
): void {
  useEffect(() => {
    if (data === undefined) {
      return;
    }
    const activeId = ensureConversationForServerId(store, conversationId);
    // In-flight gate (create-first, page 1 only): a create-first send (DW home →
    // first message) seeds an immediately-stale EMPTY history page, so the chat
    // page's mount refetches page 1 — which the backend has already persisted the
    // just-sent human turn into (numeric id + turnId). Merging that back mid-send
    // races the optimistic row (still turnId-less until the first stream frame
    // stamps it), so neither the id nor the turnId dedup catches the twin and the
    // turn renders twice. Page 1 is the ONLY page that can carry the twin (it's
    // the newest), so skipping just page 1 kills the dup while leaving the
    // user-driven `fetchOlder` pages (2+) free to merge. Gated on BOTH an
    // in-flight send AND the create-first marker: an EXISTING conversation's page
    // 1 holds real history (not a twin), so it is never skipped — else a send
    // fired during its first-load skeleton would strand that history until
    // remount. Revisit / reconnect / settled all merge the whole set as before.
    const conversation = store.get(conversationsAtom).get(activeId);
    const isCreateFirst =
      conversationId !== undefined &&
      store.get(createFirstConversationIdsAtom).has(conversationId);
    const skipPageOne = isCreateFirst && conversation?.sendHandle !== undefined;
    const pages = skipPageOne ? data.pages.slice(1) : data.pages;
    // Group AFTER flattening every page so a turn split across a page boundary
    // still folds into one rendered message.
    const historical = groupTurns(toOldestFirst(pages));
    // Seed inline plans before writing history so a PlanCard mounting from this
    // hydration reads its tree from plansAtom on first render (no empty flash).
    const prevPlans = store.get(plansAtom);
    const nextPlans = seedPlans(prevPlans, historical);
    if (nextPlans !== prevPlans) {
      store.set(plansAtom, nextPlans);
    }
    store.set(
      conversationsAtom,
      produce(store.get(conversationsAtom), (map) => {
        const conv = map.get(activeId);
        if (conv) {
          mergeHistory(conv, historical);
        }
      }),
    );
  }, [data, store, conversationId]);
}

// A history-fetch failure is NON-fatal: the message list keeps rendering the
// store (optimistic + streamed messages stay visible). Surface it as a log +
// toast, deduped by error identity so a re-render can't re-fire the toast for
// the same failure.
//
// `isLoadingError` gates the TOAST to a FIRST-load failure only (errored with no
// cached pages → the panel is genuinely blank, so the user needs the signal). A
// background-refetch blip (`isRefetchError`: cached pages still render, and after
// a settle the store shows the just-sent turn) is logged but NOT toasted — a
// "Couldn't load messages." over a visibly-populated conversation is misleading.
function useHistoryErrorToast(
  error: Error | null,
  isLoadingError: boolean,
  agentInstanceId: number,
  conversationId: number | undefined,
): void {
  const toastedErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (error === null || toastedErrorRef.current === error) {
      return;
    }
    toastedErrorRef.current = error;
    logger.error("chat: history load failed", {
      agentInstanceId,
      conversationId,
      isLoadingError,
      error,
    });
    // Only the first-load failure blanks the panel; a background-refetch failure
    // leaves the cached/store-backed messages on screen, so toasting there would
    // contradict what the user sees.
    if (isLoadingError) {
      toast.error("Couldn't load messages.");
    }
  }, [error, isLoadingError, agentInstanceId, conversationId]);
}

export function useHistory(
  agentInstanceId: number,
  conversationId?: number,
): UseHistory {
  const apiClient = useApiClient();
  const store = useStore();
  const { chatEndpoints } = useSicoConfig();
  const { messagesPath } = resolveChatEndpoints(chatEndpoints);
  // Non-suspense: never throws to the ErrorBoundary. Shares one cache entry
  // with any suspense reader of the same key (same pattern as `use-assets-query`).
  const query = useInfiniteQuery(
    historyQueryOptions(
      agentInstanceId,
      apiClient,
      messagesPath,
      conversationId,
    ),
  );
  const { fetchNextPage } = query;

  useHydrateHistory(store, query.data, conversationId);
  useHistoryErrorToast(
    query.error,
    query.isLoadingError,
    agentInstanceId,
    conversationId,
  );

  // `fetchNextPage` is a stable react-query ref, so this wrapper is stable too.
  const fetchOlder = useCallback((): void => {
    void fetchNextPage();
  }, [fetchNextPage]);

  return {
    isPending: query.isPending,
    hasMore: query.hasNextPage,
    fetchOlder,
    isFetchingOlder: query.isFetchingNextPage,
  };
}
