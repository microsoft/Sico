import {
  type InfiniteData,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pendingTitleConversationIdsAtom } from "@/features/chat/atoms/chat-atom";
import {
  CONVERSATION_TITLE_PENDING,
  CONVERSATION_TITLE_POLL_INTERVAL_MS,
  CONVERSATION_TITLE_POLL_MAX_ATTEMPTS,
} from "@/features/chat/constants";
import {
  classifyPolledTitles,
  conversationDetailQueryKey,
  patchListTitle,
  titlePollInterval,
  usePendingConversationTitles,
} from "@/features/chat/hooks/use-pending-conversation-titles";
import type { ConversationSummary } from "@/features/chat/schemas/conversation";
import * as service from "@/features/chat/services/conversation";
import type { ConversationListPage } from "@/features/chat/services/conversation";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/chat/services/conversation");

function conv(id: number, title: string): ConversationSummary {
  return { id, title, createdAt: id, agentInstanceId: 7 };
}

function page(items: ConversationSummary[]): ConversationListPage {
  return { items, hasNext: false };
}

function infinite(
  pages: ConversationListPage[],
): InfiniteData<ConversationListPage> {
  return { pages, pageParams: pages.map((_, i) => i + 1) };
}

const listKey = ["conversations", "list", { agentInstanceId: 7 }] as const;

describe("patchListTitle", () => {
  it("replaces the matching row's title across pages", () => {
    const data = infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]);
    const next = patchListTitle(data, conv(1, "Weekly report"));
    expect(next?.pages[0]?.items[0]?.title).toBe("Weekly report");
  });

  it("returns a NEW reference for the changed page and items", () => {
    const data = infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]);
    const next = patchListTitle(data, conv(1, "Weekly report"));
    expect(next).not.toBe(data);
    expect(next?.pages[0]).not.toBe(data.pages[0]);
  });

  it("keeps unchanged pages by reference (structural sharing)", () => {
    const p1 = page([conv(1, "Kept")]);
    const p2 = page([conv(2, CONVERSATION_TITLE_PENDING)]);
    const data = infinite([p1, p2]);
    const next = patchListTitle(data, conv(2, "Resolved"));
    expect(next?.pages[0]).toBe(p1);
    expect(next?.pages[1]).not.toBe(p2);
    expect(next?.pages[1]?.items[0]?.title).toBe("Resolved");
  });

  it("is idempotent — returns the SAME reference when the title already matches", () => {
    const data = infinite([page([conv(1, "Weekly report")])]);
    const next = patchListTitle(data, conv(1, "Weekly report"));
    expect(next).toBe(data);
  });

  it("returns the same reference when no row matches the id", () => {
    const data = infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]);
    const next = patchListTitle(data, conv(999, "Nope"));
    expect(next).toBe(data);
  });

  it("returns old untouched when the cache is empty", () => {
    expect(patchListTitle(undefined, conv(1, "X"))).toBeUndefined();
  });
});

describe("titlePollInterval", () => {
  it("keeps polling while the title is still the placeholder", () => {
    expect(
      titlePollInterval({
        data: conv(1, CONVERSATION_TITLE_PENDING),
        dataUpdateCount: 1,
        errorUpdateCount: 0,
      }),
    ).toBe(2000);
  });

  it("keeps polling before the first fetch resolves (no data yet)", () => {
    expect(
      titlePollInterval({
        data: undefined,
        dataUpdateCount: 0,
        errorUpdateCount: 0,
      }),
    ).toBe(2000);
  });

  it("stops once a real title arrives", () => {
    expect(
      titlePollInterval({
        data: conv(1, "Weekly report"),
        dataUpdateCount: 2,
        errorUpdateCount: 0,
      }),
    ).toBe(false);
  });

  it("stops at the attempt cap even if still pending", () => {
    expect(
      titlePollInterval({
        data: conv(1, CONVERSATION_TITLE_PENDING),
        dataUpdateCount: 30,
        errorUpdateCount: 0,
      }),
    ).toBe(false);
  });

  it("counts errors toward the cap so an erroring endpoint still stops", () => {
    // errorUpdateCount is the counter react-query ACCUMULATES across poll cycles
    // (fetchFailureCount resets each fetch), so a never-succeeding endpoint still
    // reaches the cap.
    expect(
      titlePollInterval({
        data: undefined,
        dataUpdateCount: 0,
        errorUpdateCount: 30,
      }),
    ).toBe(false);
  });

  it("sums successes and errors toward the cap", () => {
    expect(
      titlePollInterval({
        data: conv(1, CONVERSATION_TITLE_PENDING),
        dataUpdateCount: 15,
        errorUpdateCount: 15,
      }),
    ).toBe(false);
  });
});

function makeWrapper(
  queryClient: QueryClient,
  store: ReturnType<typeof createStore>,
): (props: { children: ReactNode }) => ReactElement {
  const apiClient = {} as AxiosInstance;
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </JotaiProvider>
      </QueryClientProvider>
    );
  };
}

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

// A client whose default is `retry: 3` — like the production app client. Used to
// prove titleQueryConfig's own `retry: false` OVERRIDES that default: if it
// didn't, each errored poll would run 4 attempts + backoff and the error budget
// would blow past 1 minute.
function retryingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 3 } },
  });
}

beforeEach(() => {
  vi.mocked(service.getConversation).mockReset();
});

// Drive a real rejecting fetch `n` times so `errorUpdateCount` accumulates to
// `n` while `fetchFailureCount` stays 1 (it resets each fetch). This is the exact
// runtime shape the error-path cap must handle — a fixture couldn't reproduce it.
async function seedErroredQuery(
  queryClient: QueryClient,
  id: number,
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await queryClient
      .fetchQuery({
        queryKey: conversationDetailQueryKey(id),
        queryFn: () => Promise.reject(new Error("boom")),
      })
      .catch(() => undefined);
  }
}

describe("classifyPolledTitles", () => {
  it("marks a resolved id as both resolved and settled", () => {
    const queryClient = freshClient();
    queryClient.setQueryData(
      conversationDetailQueryKey(1),
      conv(1, "Weekly report"),
    );

    const { resolved, settled } = classifyPolledTitles(queryClient, [1]);

    expect(resolved).toEqual([conv(1, "Weekly report")]);
    expect(settled).toEqual([1]);
  });

  it("leaves a still-pending id unsettled so it keeps polling", () => {
    const queryClient = freshClient();
    queryClient.setQueryData(
      conversationDetailQueryKey(1),
      conv(1, CONVERSATION_TITLE_PENDING),
    );

    const { resolved, settled } = classifyPolledTitles(queryClient, [1]);

    expect(resolved).toEqual([]);
    expect(settled).toEqual([]);
  });

  it("settles (without resolving) an id that hit the cap purely on errors", async () => {
    // Guards the error-path cap: errorUpdateCount accumulates across poll cycles
    // while fetchFailureCount resets each fetch. classify must count
    // errorUpdateCount, or a never-succeeding endpoint would never settle and
    // would poll forever.
    const queryClient = freshClient();
    await seedErroredQuery(
      queryClient,
      1,
      CONVERSATION_TITLE_POLL_MAX_ATTEMPTS,
    );

    const { resolved, settled } = classifyPolledTitles(queryClient, [1]);

    expect(resolved).toEqual([]);
    expect(settled).toEqual([1]);
  });

  it("does not settle an errored id that is still under the cap", async () => {
    const queryClient = freshClient();
    await seedErroredQuery(
      queryClient,
      1,
      CONVERSATION_TITLE_POLL_MAX_ATTEMPTS - 1,
    );

    const { settled } = classifyPolledTitles(queryClient, [1]);

    expect(settled).toEqual([]);
  });

  it("skips ids with no cached query state", () => {
    const queryClient = freshClient();

    const { resolved, settled } = classifyPolledTitles(queryClient, [999]);

    expect(resolved).toEqual([]);
    expect(settled).toEqual([]);
  });
});

describe("usePendingConversationTitles", () => {
  it("polls a pending id from the set and patches the resolved title into the list cache", async () => {
    vi.mocked(service.getConversation).mockResolvedValue(
      conv(1, "Weekly report"),
    );
    const queryClient = freshClient();
    queryClient.setQueryData(
      listKey,
      infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]),
    );
    const store = createStore();
    store.set(pendingTitleConversationIdsAtom, new Set([1]));

    renderHook(() => usePendingConversationTitles(), {
      wrapper: makeWrapper(queryClient, store),
    });

    await waitFor(() => {
      const data =
        queryClient.getQueryData<InfiniteData<ConversationListPage>>(listKey);
      expect(data?.pages[0]?.items[0]?.title).toBe("Weekly report");
    });
    expect(service.getConversation).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it("removes a resolved id from the set so it never polls again", async () => {
    vi.mocked(service.getConversation).mockResolvedValue(
      conv(1, "Weekly report"),
    );
    const queryClient = freshClient();
    queryClient.setQueryData(
      listKey,
      infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]),
    );
    const store = createStore();
    store.set(pendingTitleConversationIdsAtom, new Set([1]));

    renderHook(() => usePendingConversationTitles(), {
      wrapper: makeWrapper(queryClient, store),
    });

    await waitFor(() =>
      expect(store.get(pendingTitleConversationIdsAtom).has(1)).toBe(false),
    );
  });

  it("patches a resolved title even when the record carries no agentInstanceId", async () => {
    // agentInstanceId is nullish in the schema; the patch must match the row by
    // conversation id alone (globally unique) so a title never silently drops.
    vi.mocked(service.getConversation).mockResolvedValue({
      id: 1,
      title: "Weekly report",
      createdAt: 1,
      agentInstanceId: undefined,
    });
    const queryClient = freshClient();
    queryClient.setQueryData(
      listKey,
      infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]),
    );
    const store = createStore();
    store.set(pendingTitleConversationIdsAtom, new Set([1]));

    renderHook(() => usePendingConversationTitles(), {
      wrapper: makeWrapper(queryClient, store),
    });

    await waitFor(() => {
      const data =
        queryClient.getQueryData<InfiniteData<ConversationListPage>>(listKey);
      expect(data?.pages[0]?.items[0]?.title).toBe("Weekly report");
    });
  });

  it("does not poll when the set is empty (a 'New Session' row alone is not a trigger)", () => {
    const queryClient = freshClient();
    queryClient.setQueryData(
      listKey,
      infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]),
    );
    const store = createStore();
    store.set(pendingTitleConversationIdsAtom, new Set());

    renderHook(() => usePendingConversationTitles(), {
      wrapper: makeWrapper(queryClient, store),
    });

    expect(service.getConversation).not.toHaveBeenCalled();
  });

  it("stops after the 1-minute cap and removes the id, leaving the placeholder intact", async () => {
    vi.useFakeTimers();
    try {
      // Backend never finishes naming the conversation — every poll returns the
      // placeholder. Polling must give up at the cap (2s × 30 = 1min), remove the
      // id from the set (so a remount never restarts it), and leave the row's
      // title untouched (never blanked).
      vi.mocked(service.getConversation).mockResolvedValue(
        conv(1, CONVERSATION_TITLE_PENDING),
      );
      const queryClient = freshClient();
      queryClient.setQueryData(
        listKey,
        infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]),
      );
      const store = createStore();
      store.set(pendingTitleConversationIdsAtom, new Set([1]));

      renderHook(() => usePendingConversationTitles(), {
        wrapper: makeWrapper(queryClient, store),
      });

      // Drive well past the 30-attempt cap (60 intervals of 2s).
      await vi.advanceTimersByTimeAsync(
        CONVERSATION_TITLE_POLL_INTERVAL_MS * 60,
      );
      const callsAtCap = vi.mocked(service.getConversation).mock.calls.length;
      expect(callsAtCap).toBeLessThanOrEqual(
        CONVERSATION_TITLE_POLL_MAX_ATTEMPTS,
      );

      // Polling has stopped: more time advances add no further calls.
      await vi.advanceTimersByTimeAsync(
        CONVERSATION_TITLE_POLL_INTERVAL_MS * 10,
      );
      expect(vi.mocked(service.getConversation).mock.calls.length).toBe(
        callsAtCap,
      );

      // Timed-out id removed (so a remount won't restart it) and title kept.
      expect(store.get(pendingTitleConversationIdsAtom).has(1)).toBe(false);
      const data =
        queryClient.getQueryData<InfiniteData<ConversationListPage>>(listKey);
      expect(data?.pages[0]?.items[0]?.title).toBe(CONVERSATION_TITLE_PENDING);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops and removes the id when the endpoint errors every poll", async () => {
    vi.useFakeTimers();
    try {
      // The detail endpoint rejects every time (deleted conversation, 5xx). Run
      // under a `retry: 3` client (like production) to prove titleQueryConfig's
      // own `retry: false` overrides it: each poll must be exactly one error →
      // one errorUpdateCount bump, so the cap is reached in ~30 polls. Without the
      // override, retries + backoff would blow the 1-min budget to several min.
      vi.mocked(service.getConversation).mockRejectedValue(new Error("boom"));
      const queryClient = retryingClient();
      queryClient.setQueryData(
        listKey,
        infinite([page([conv(1, CONVERSATION_TITLE_PENDING)])]),
      );
      const store = createStore();
      store.set(pendingTitleConversationIdsAtom, new Set([1]));

      renderHook(() => usePendingConversationTitles(), {
        wrapper: makeWrapper(queryClient, store),
      });

      // Drive well past the cap (each poll is one error).
      await vi.advanceTimersByTimeAsync(
        CONVERSATION_TITLE_POLL_INTERVAL_MS * 60,
      );
      const callsAtCap = vi.mocked(service.getConversation).mock.calls.length;
      expect(callsAtCap).toBeLessThanOrEqual(
        CONVERSATION_TITLE_POLL_MAX_ATTEMPTS,
      );

      // Polling has stopped: further time adds no calls.
      await vi.advanceTimersByTimeAsync(
        CONVERSATION_TITLE_POLL_INTERVAL_MS * 10,
      );
      expect(vi.mocked(service.getConversation).mock.calls.length).toBe(
        callsAtCap,
      );

      // The erroring id is removed so a remount never restarts its poll.
      expect(store.get(pendingTitleConversationIdsAtom).has(1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
