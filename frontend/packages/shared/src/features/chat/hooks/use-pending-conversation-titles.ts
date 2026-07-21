import {
  type InfiniteData,
  type QueryClient,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { useAtom } from "jotai";
import { useEffect, useRef } from "react";

import { useApiClient } from "../../../services/api-client-context";
import { pendingTitleConversationIdsAtom } from "../atoms/chat-atom";
import {
  CONVERSATION_TITLE_PENDING,
  CONVERSATION_TITLE_POLL_INTERVAL_MS,
  CONVERSATION_TITLE_POLL_MAX_ATTEMPTS,
} from "../constants";
import { type ConversationSummary } from "../schemas/conversation";
import {
  type ConversationListPage,
  getConversation,
} from "../services/conversation";

// Immutably swap one row's title in the sidebar's infinite-list cache. Walks
// every loaded page; the matched row is rebuilt along a fresh reference path
// (data → page → items → item) so react-query sees the change, while untouched
// pages keep their identity (structural sharing → no needless re-render). Returns
// the SAME `data` reference when nothing changed (id absent, or title already
// equal) — that idempotence is what lets the write run from an effect without
// looping. Mirrors the setQueryData surgery in use-history.ts.
export function patchListTitle(
  data: InfiniteData<ConversationListPage> | undefined,
  resolved: ConversationSummary,
): InfiniteData<ConversationListPage> | undefined {
  if (!data) {
    return data;
  }
  const pages = data.pages.map((page) => {
    const i = page.items.findIndex((c) => c.id === resolved.id);
    const current = page.items[i];
    if (current === undefined || current.title === resolved.title) {
      return page;
    }
    const items = page.items.slice();
    items[i] = { ...current, title: resolved.title };
    return { ...page, items };
  });
  // Detect a real change by reference (a matched row produced a new page object).
  // Deriving `changed` this way — rather than a flag mutated inside .map — keeps
  // the idempotent path returning the SAME `data` reference (no re-render).
  const changed = pages.some((page, i) => page !== data.pages[i]);
  return changed ? { ...data, pages } : data;
}

// The slice of a react-query observer's state the poll decision reads.
// `dataUpdateCount` (successes) and `errorUpdateCount` (errors) are the counters
// react-query ACCUMULATES across poll cycles — NOT `fetchFailureCount`, which
// resets to 0 at the start of every fetch (so it counts retries within one poll,
// never poll cycles). Summing the two accumulating counters is what bounds BOTH
// a stuck-pending endpoint and a persistently-erroring one.
type TitlePollState = {
  data: ConversationSummary | undefined;
  dataUpdateCount: number;
  errorUpdateCount: number;
};

// A real title has arrived (the poll's job is done). Shared by the interval and
// the classify pass so the two can't drift. Type predicate so a true result
// narrows `data` to a present record at the call site.
function isTitleResolved(
  data: ConversationSummary | undefined,
): data is ConversationSummary {
  return data !== undefined && data.title !== CONVERSATION_TITLE_PENDING;
}

// The poll has exhausted its 1-min budget: successes + errors (the two
// accumulating counters) reached the cap. Shared so the interval and the
// classify pass apply the identical stop rule and can't drift.
function isTitlePollExhausted(state: TitlePollState): boolean {
  return (
    state.dataUpdateCount + state.errorUpdateCount >=
    CONVERSATION_TITLE_POLL_MAX_ATTEMPTS
  );
}

// Poll decision for one conversation-detail query: keep polling (2s) while the
// title is still the placeholder, stop once a real title lands OR the attempt cap
// is hit. Errors count toward the cap (via the accumulating errorUpdateCount) so
// an endpoint that errors every time still stops instead of polling forever.
export function titlePollInterval(state: TitlePollState): number | false {
  if (isTitleResolved(state.data) || isTitlePollExhausted(state)) {
    return false;
  }
  return CONVERSATION_TITLE_POLL_INTERVAL_MS;
}

// The by-id detail query key. One definition shared by the poll config, the
// classify read, and the tests, so the key can't drift between call sites.
export function conversationDetailQueryKey(
  id: number,
): readonly ["conversations", "detail", number] {
  return ["conversations", "detail", id] as const;
}

// Per-id poll config for one pending conversation. Extracted so the hook body
// stays small and the verbose refetchInterval state type lives in one place.
// `retry: false` so each errored poll is exactly one `errorUpdateCount` bump —
// otherwise the app-default `retry: 3` would run 4 attempts + backoff per cycle,
// stretching the 1-min error budget to several minutes of extra requests.
function titleQueryConfig(
  apiClient: AxiosInstance,
  id: number,
): {
  queryKey: readonly ["conversations", "detail", number];
  queryFn: () => Promise<ConversationSummary>;
  staleTime: number;
  gcTime: number;
  retry: false;
  refetchInterval: (query: { state: TitlePollState }) => number | false;
} {
  return {
    queryKey: conversationDetailQueryKey(id),
    queryFn: (): Promise<ConversationSummary> => getConversation(apiClient, id),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: (query): number | false => titlePollInterval(query.state),
  };
}

// Classify each polled id from its cached query state. `resolved` = a real title
// arrived (patch it into the list); `settled` = resolved OR the 1-min cap was hit
// with the title still pending (remove from the set either way — an unresolved
// timeout must NOT linger, or a remount would restart its poll, the very bug this
// set-based trigger fixes). Reads counts off the cached state because the observer
// result doesn't expose dataUpdateCount / errorUpdateCount.
export function classifyPolledTitles(
  queryClient: QueryClient,
  ids: readonly number[],
): { resolved: ConversationSummary[]; settled: number[] } {
  const resolved: ConversationSummary[] = [];
  const settled: number[] = [];
  for (const id of ids) {
    const state = queryClient.getQueryState<ConversationSummary>(
      conversationDetailQueryKey(id),
    );
    if (state === undefined) {
      continue;
    }
    if (isTitleResolved(state.data)) {
      resolved.push(state.data);
      settled.push(id);
    } else if (isTitlePollExhausted(state)) {
      settled.push(id);
    }
  }
  return { resolved, settled };
}

// Patch each resolved title into whichever loaded conversation-list cache holds
// its row. Matched by conversation id alone (globally unique) via setQueriesData
// over the `["conversations", "list"]` prefix — so a record missing the nullish
// `agentInstanceId` still lands, and a title created under agent A resolves even
// while agent B's sidebar is on screen. `patchListTitle` is idempotent, so the
// caches that don't hold the row are returned unchanged (no needless render).
function patchResolvedTitles(
  queryClient: QueryClient,
  resolved: readonly ConversationSummary[],
): void {
  queryClient.setQueriesData<InfiniteData<ConversationListPage>>(
    { queryKey: ["conversations", "list"] },
    (old) => {
      let next = old;
      for (const c of resolved) {
        next = patchListTitle(next, c);
      }
      return next;
    },
  );
}

// Resolve the async-generated titles of conversations created THIS session. The
// trigger is `pendingTitleConversationIdsAtom` (written by useCreateConversation),
// NOT a "title === 'New Session'" scan — so a conversation that legitimately keeps
// that name is never polled. Each pending id is polled by id (`GET /conversation?id=`)
// until its real title lands or a 1-min budget expires; a resolved title is patched
// into its DW's list cache in place (no reorder/flicker), and every settled id
// (resolved OR timed out) is removed from the set so it never polls again — not even
// on remount. Effect-only. Mounted in the sidebar (the sole title consumer).
export function usePendingConversationTitles(): void {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [pendingIds, setPendingIds] = useAtom(pendingTitleConversationIdsAtom);
  const ids = [...pendingIds];

  const results = useQueries({
    queries: ids.map((id) => titleQueryConfig(apiClient, id)),
  });

  // Fingerprint of every poll's progress, so the effect fires only when a poll
  // actually advances (not on unrelated renders). `dataUpdatedAt` bumps on each
  // success (a resolved title, or a step toward the pending cap); `errorUpdatedAt`
  // bumps on each error (a step toward the error cap) — the two accumulating
  // signals that mirror the cap counters, so a timed-out-on-error id is released.
  const signal = results
    .map((r, i) => `${ids[i]}:${r.dataUpdatedAt}:${r.errorUpdatedAt}`)
    .join("|");
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(() => {
    const { resolved, settled } = classifyPolledTitles(
      queryClient,
      idsRef.current,
    );
    if (settled.length === 0) {
      return;
    }
    // Only touch the list caches when a title actually resolved — a pure timeout
    // settle has nothing to patch, and setQueriesData would otherwise dispatch a
    // no-op update to every list query.
    if (resolved.length > 0) {
      patchResolvedTitles(queryClient, resolved);
    }
    setPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of settled) {
        next.delete(id);
      }
      return next;
    });
  }, [signal, queryClient, setPendingIds]);
}
