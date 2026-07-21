import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeConversationAtom,
  activeConversationIdAtom,
  conversationsAtom,
  createFirstConversationIdsAtom,
  type Message,
  plansAtom,
} from "@/features/chat/atoms/chat-atom";
import {
  historyQueryOptions,
  seedEmptyHistory,
  useHistory,
} from "@/features/chat/hooks/use-history";
import { type Plan, PlanStatusSchema } from "@/features/chat/schemas/plan";
import { fetchHistory } from "@/features/chat/services/history";
import { ApiClientProvider } from "@/services/api-client-context";
import { logger } from "@/utils/logger";

// fetchHistory is mocked, so the axios instance is never actually called.
vi.mock("@/features/chat/services/history");

// Stub `toast.error` so the history-failure test can assert the in-place toast
// (non-suspense: a failed fetch surfaces here, never throws to a boundary).
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { error: vi.fn() } };
});

const apiClient = {} as AxiosInstance;

// One wrapper carries all three providers: react-query (fetch/cache/dedup),
// the jotai store (the render source-of-truth this hook hydrates), and the
// api-client context `useHistory` reads. `retry: false` so a rejected page
// surfaces immediately instead of after backoff. No <Suspense> needed —
// `useHistory` is non-suspense (`useInfiniteQuery`), so it never suspends.
function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </JotaiProvider>
      </QueryClientProvider>
    );
  }

  return Wrapper;
}

// Historical messages carry numeric-string ids (the wire `messageId`); a higher
// id is newer. The service already parses wire → `Message`, so the mocked page
// returns store-shaped `Message` objects directly.
function aiMessage(id: string, text: string): Message {
  return {
    id,
    author: "ai",
    content: [{ partId: `${id}:0`, type: "text", text }],
    turnId: Number(id),
  };
}

// A persisted HUMAN history row: numeric-string id + a turnId (a higher id is
// newer), same shape the service parses from the wire.
function humanMessage(id: string, text: string): Message {
  return {
    id,
    author: "human",
    content: [{ partId: `${id}:0`, type: "text", text }],
    turnId: Number(id),
  };
}

beforeEach(() => {
  vi.mocked(fetchHistory).mockReset();
});

describe("useHistory", () => {
  it("hydrates the atom from page 1 and renders from the atom", async () => {
    const store = createStore();
    // Wire is newest-first: items[0] is the newest message.
    const newest = aiMessage("100", "newest");
    const older = aiMessage("99", "older");
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [newest, older],
      hasNext: false,
    });

    const { result } = renderHook(() => useHistory(1), {
      wrapper: wrapper(store),
    });

    await waitFor(() => expect(store.get(conversationsAtom).size).toBe(1));

    // The hook mints an active conversation and hydrates it.
    expect(store.get(activeConversationIdAtom)).not.toBeNull();
    const conv = store.get(activeConversationAtom);
    // Rendered oldest→newest — reversed vs the newest-first wire.
    expect(conv?.history.map((m) => m.id)).toEqual(["99", "100"]);
    expect(conv?.history.at(-1)?.id).toBe("100");
    expect(result.current.hasMore).toBe(false);
  });

  it("fetchNextPage prepends older messages, deduping by id", async () => {
    const store = createStore();
    const m100 = aiMessage("100", "newest");
    const m99 = aiMessage("99", "middle");
    const m98 = aiMessage("98", "oldest");
    // m99 overlaps both pages; the page-1 copy must win (newest wins).
    vi.mocked(fetchHistory)
      .mockResolvedValueOnce({ items: [m100, m99], hasNext: true })
      .mockResolvedValueOnce({ items: [m99, m98], hasNext: false });

    const { result } = renderHook(() => useHistory(1), {
      wrapper: wrapper(store),
    });

    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history).toHaveLength(2),
    );
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      result.current.fetchOlder();
    });

    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history).toHaveLength(3),
    );
    const conv = store.get(activeConversationAtom);
    // Older page prepended, deduped — no duplicate m99.
    expect(conv?.history.map((m) => m.id)).toEqual(["98", "99", "100"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("skips only the create-first page-1 twin while a send is in-flight", async () => {
    const store = createStore();
    // A fresh create-first send, still streaming: the optimistic human (client
    // UUID, no turnId yet) + the AI placeholder, and a `sendHandle` (the
    // in-flight AbortController). This is the ↻/Thinking window.
    const optimisticHuman: Message = {
      id: "human-uuid",
      author: "human",
      content: [
        { partId: "human:0", type: "text", text: "run first testcase" },
      ],
    };
    const aiPlaceholder: Message = {
      id: "ai-uuid",
      author: "ai",
      content: [],
      streamingState: "pending",
    };
    // create-first conversation: server id 42, keyed by String(id), and
    // registered in the create-first set (as useCreateConversation does).
    const conversationId = 42;
    store.set(
      conversationsAtom,
      new Map([
        [
          String(conversationId),
          {
            clientId: String(conversationId),
            conversationId,
            history: [optimisticHuman, aiPlaceholder],
            sendHandle: new AbortController(),
          },
        ],
      ]),
    );
    store.set(activeConversationIdAtom, String(conversationId));
    store.set(createFirstConversationIdsAtom, new Set([conversationId]));

    // The stale create-first seed makes the mount refetch page 1 — a SINGLE page
    // holding the persisted twin of the just-sent human (numeric id + turnId).
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [humanMessage("100", "run first testcase")],
      hasNext: false,
    });

    const { result } = renderHook(() => useHistory(1, conversationId), {
      wrapper: wrapper(store),
    });

    // Barrier: isPending flips false only after the fetch resolves + the render
    // commits, and renderHook flushes the data-keyed hydrate effect in the same
    // act — so hydration has had its chance.
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(fetchHistory).toHaveBeenCalled();
    // Page 1 (the only page) is skipped in-flight → the twin never merges; the
    // store still holds only the optimistic turn + placeholder.
    const history = store.get(activeConversationAtom)?.history;
    expect(history?.map((m) => m.id)).toEqual(["human-uuid", "ai-uuid"]);
  });

  it("does NOT skip page 1 for an EXISTING conversation with an in-flight send", async () => {
    const store = createStore();
    // The I1 regression guard: an EXISTING conversation (NOT create-first, so its
    // id is absent from createFirstConversationIdsAtom). The user sends during the
    // first-load skeleton (`sendHandle` set, optimistic row in the store) BEFORE
    // page 1 resolves. Page 1 here holds REAL history (not the just-sent twin), so
    // it MUST still merge — the over-narrow create-first gate would otherwise
    // strand this history until remount.
    const optimisticHuman: Message = {
      id: "opt-uuid",
      author: "human",
      content: [{ partId: "opt:0", type: "text", text: "new question" }],
    };
    const conversationId = 77;
    store.set(
      conversationsAtom,
      new Map([
        [
          String(conversationId),
          {
            clientId: String(conversationId),
            conversationId,
            history: [optimisticHuman],
            sendHandle: new AbortController(),
          },
        ],
      ]),
    );
    store.set(activeConversationIdAtom, String(conversationId));
    // NOTE: conversationId 77 is deliberately NOT in createFirstConversationIdsAtom.

    // Page 1 = real older history (3 turns), NOT the just-sent optimistic row.
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [
        humanMessage("30", "old3"),
        humanMessage("20", "old2"),
        humanMessage("10", "old1"),
      ],
      hasNext: false,
    });

    const { result } = renderHook(() => useHistory(1, conversationId), {
      wrapper: wrapper(store),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    // Real page-1 history merged (oldest→newest) AND the optimistic row kept —
    // nothing stranded.
    const history = store.get(activeConversationAtom)?.history;
    expect(history?.map((m) => m.id)).toEqual(["10", "20", "30", "opt-uuid"]);
  });

  it("does NOT skip page 1 on a cold revisit after the create-first send settled", async () => {
    const store = createStore();
    // A create-first conversation whose FIRST send already settled: `onSettle`
    // (use-chat) has removed its id from createFirstConversationIdsAtom, so the
    // twin risk is over and page 1 now holds real history. On a cold revisit
    // (cache evicted) the user sends again during the skeleton — `sendHandle` set
    // — but page 1 must STILL merge: without the settle-time clear, the stale
    // marker + in-flight send would re-strand the real history (residual I1).
    const optimisticHuman: Message = {
      id: "opt-uuid",
      author: "human",
      content: [{ partId: "opt:0", type: "text", text: "second question" }],
    };
    const conversationId = 88;
    store.set(
      conversationsAtom,
      new Map([
        [
          String(conversationId),
          {
            clientId: String(conversationId),
            conversationId,
            history: [optimisticHuman],
            sendHandle: new AbortController(),
          },
        ],
      ]),
    );
    store.set(activeConversationIdAtom, String(conversationId));
    // Marker was cleared on the first send's settle → the set does NOT contain 88.
    store.set(createFirstConversationIdsAtom, new Set<number>());

    vi.mocked(fetchHistory).mockResolvedValue({
      items: [humanMessage("20", "old2"), humanMessage("10", "old1")],
      hasNext: false,
    });

    const { result } = renderHook(() => useHistory(1, conversationId), {
      wrapper: wrapper(store),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    // Real page-1 history merged; the just-sent optimistic row kept.
    const history = store.get(activeConversationAtom)?.history;
    expect(history?.map((m) => m.id)).toEqual(["10", "20", "opt-uuid"]);
  });

  it("still merges older pages (fetchOlder) while a send is in-flight", async () => {
    const store = createStore();
    // An EXISTING conversation (page 1 already loaded into the store) where the
    // user sends a message — `sendHandle` set — then scrolls up to load an older
    // page. The older page MUST still render (regression guard for the over-broad
    // gate that dropped all in-flight hydration).
    const loadedHuman = humanMessage("100", "already here");
    const clientId = "client-existing";
    store.set(
      conversationsAtom,
      new Map([
        [
          clientId,
          {
            clientId,
            history: [loadedHuman],
            sendHandle: new AbortController(),
          },
        ],
      ]),
    );
    store.set(activeConversationIdAtom, clientId);

    // Page 1 = the already-loaded turn (has a next page); page 2 = older history.
    vi.mocked(fetchHistory)
      .mockResolvedValueOnce({
        items: [humanMessage("100", "already here")],
        hasNext: true,
      })
      .mockResolvedValueOnce({
        items: [aiMessage("50", "older answer")],
        hasNext: false,
      });

    const { result } = renderHook(() => useHistory(1), {
      wrapper: wrapper(store),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    // Scroll up → fetchOlder appends page 2 (older). In-flight only skips page 1;
    // the older page still hydrates.
    await act(async () => {
      result.current.fetchOlder();
    });
    await waitFor(() =>
      expect(
        store.get(activeConversationAtom)?.history.some((m) => m.id === "50"),
      ).toBe(true),
    );
    const history = store.get(activeConversationAtom)?.history;
    // Older row prepended above the already-loaded turn — no duplicate of 100.
    expect(history?.map((m) => m.id)).toEqual(["50", "100"]);
  });

  it("merges all pages when no send is in-flight (revisit)", async () => {
    const store = createStore();
    // A settled/revisit conversation: no `sendHandle`, so the gate is open and
    // page 1 hydrates normally.
    const clientId = "client-revisit";
    store.set(
      conversationsAtom,
      new Map([[clientId, { clientId, history: [] }]]),
    );
    store.set(activeConversationIdAtom, clientId);

    vi.mocked(fetchHistory).mockResolvedValue({
      items: [aiMessage("101", "answer"), humanMessage("100", "question")],
      hasNext: false,
    });

    renderHook(() => useHistory(1), { wrapper: wrapper(store) });

    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history.at(-1)?.id).toBe("101"),
    );
    const history = store.get(activeConversationAtom)?.history;
    // Full page-1 hydrated, oldest→newest.
    expect(history?.map((m) => m.id)).toEqual(["100", "101"]);
  });

  it("does not overwrite a streaming tail when an older page resolves mid-stream", async () => {
    const store = createStore();
    // A streaming-tail message minted by sendMessage: a uuid-ish id (never a
    // numeric history id) and a live streamingState.
    const streamingTail: Message = {
      id: "live-tail-uuid",
      author: "ai",
      content: [{ partId: "live:0", type: "text", text: "typing…" }],
      streamingState: "streaming",
    };
    const clientId = "client-1";
    // Seed ONLY the tail (length 1) so the merge must grow history 1→2 — the
    // wait then gates on hydration actually running, not on the pre-seed state.
    store.set(
      conversationsAtom,
      new Map([[clientId, { clientId, history: [streamingTail] }]]),
    );
    store.set(activeConversationIdAtom, clientId);

    // Page carries a persisted history item, NOT the live tail.
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [aiMessage("100", "history")],
      hasNext: false,
    });

    renderHook(() => useHistory(1), { wrapper: wrapper(store) });

    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history).toHaveLength(2),
    );
    const history = store.get(activeConversationAtom)?.history;
    // Historical row prepended ABOVE the tail; the live tail kept its exact
    // reference + streamingState and stayed last.
    expect(history?.map((m) => m.id)).toEqual(["100", "live-tail-uuid"]);
    expect(history?.at(-1)).toBe(streamingTail);
    expect(history?.at(-1)?.streamingState).toBe("streaming");
  });

  it("dedups a live copy whose turnId already exists in history (reload mid-stream)", async () => {
    const store = createStore();
    // Mid-stream reload: the streaming turn (turnId 100) was persisted with a
    // backend numeric id, while the resumed live copy still carries a client
    // UUID + the SAME turnId. Without turnId-dedup both render → duplicate.
    const liveCopy: Message = {
      id: "live-uuid-dup",
      author: "ai",
      content: [{ partId: "live:0", type: "text", text: "resuming…" }],
      streamingState: "streaming",
      turnId: 100,
    };
    const clientId = "client-dup";
    store.set(
      conversationsAtom,
      new Map([[clientId, { clientId, history: [liveCopy] }]]),
    );
    store.set(activeConversationIdAtom, clientId);

    // History returns the persisted version of the SAME turn (turnId 100).
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [aiMessage("100", "resuming…")],
      hasNext: false,
    });

    renderHook(() => useHistory(1), { wrapper: wrapper(store) });

    // Gate on hydration actually running: the persisted row "100" replaces the
    // live copy. (Length stays 1 the whole time, so a length gate would pass on
    // the pre-hydration state — wait for the id to flip instead.)
    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history[0]?.id).toBe("100"),
    );
    const history = store.get(activeConversationAtom)?.history;
    // The live copy (same turnId) was dropped → exactly one row, the persisted.
    expect(history?.map((m) => m.id)).toEqual(["100"]);
  });

  it("a first-page failure does not throw, preserves the store, and toasts once", async () => {
    const store = createStore();
    // Pre-seed an optimistic message: the failure must NOT wipe it (the whole
    // point of the decouple — history is not the render source).
    const optimistic: Message = {
      id: "optimistic",
      author: "human",
      content: [{ partId: "o:0", type: "text", text: "just sent" }],
    };
    store.set(
      conversationsAtom,
      new Map([["c1", { clientId: "c1", history: [optimistic] }]]),
    );
    store.set(activeConversationIdAtom, "c1");
    vi.mocked(fetchHistory).mockRejectedValue(
      new Error("fetchHistory: rejected (code 100004)"),
    );

    const { result } = renderHook(() => useHistory(1), {
      wrapper: wrapper(store),
    });

    const { toast } = await import("@sico/ui");
    // The failure surfaces as a toast (non-suspense: it never throws), and the
    // hook settles out of pending — renderHook did NOT crash.
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.isPending).toBe(false));
    // The optimistic message is untouched — history failure is non-destructive.
    expect(store.get(activeConversationAtom)?.history).toEqual([optimistic]);
  });

  it("does not raise a second toast when the same error re-renders", async () => {
    const store = createStore();
    vi.mocked(fetchHistory).mockRejectedValue(new Error("boom"));

    const { rerender } = renderHook(() => useHistory(1), {
      wrapper: wrapper(store),
    });

    const { toast } = await import("@sico/ui");
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    // A re-render with the SAME cached error must not re-fire the toast (deduped
    // by error identity), or every render would spam the surface.
    rerender();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("logs but does NOT toast when a background page fetch fails (first load succeeded)", async () => {
    const store = createStore();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    // First page resolves (so isLoadingError stays false), and reports another
    // page so fetchOlder is armed.
    vi.mocked(fetchHistory).mockResolvedValueOnce({
      items: [{ id: "m1", author: "human", content: [] }],
      hasNext: true,
    });
    const { result } = renderHook(() => useHistory(1), {
      wrapper: wrapper(store),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    const { toast } = await import("@sico/ui");
    vi.mocked(toast.error).mockClear();
    // The NEXT (background) page rejects — the panel is already populated, so
    // this must log but NOT toast (toasting over visible messages misleads).
    vi.mocked(fetchHistory).mockRejectedValue(new Error("page 2 boom"));
    act(() => {
      result.current.fetchOlder();
    });
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("hydrates nothing before the first page resolves (data undefined is a no-op)", () => {
    const store = createStore();
    // A never-resolving fetch keeps `data` undefined; the hydrate effect must
    // guard it (reading `data.pages` would otherwise crash) and touch no atom.
    vi.mocked(fetchHistory).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useHistory(1), {
      wrapper: wrapper(store),
    });

    expect(result.current.isPending).toBe(true);
    // No conversation minted, no plans seeded — nothing hydrated yet.
    expect(store.get(conversationsAtom).size).toBe(0);
    expect(store.get(plansAtom).size).toBe(0);
  });

  it("folds same-turn items into one consolidated message (plan + text on one turn)", async () => {
    const store = createStore();
    // One backend turn split across rows that share turnId 9: assistant plan +
    // assistant text. messageItemSchema maps each 1:1, so the hook must fold.
    const aiPlan: Message = {
      id: "200",
      author: "ai",
      content: [{ partId: "200:0", type: "plan", planId: "9" }],
      turnId: 9,
      createdAt: 200,
    };
    const aiText: Message = {
      id: "201",
      author: "ai",
      content: [{ partId: "201:0", type: "text", text: "done" }],
      turnId: 9,
      createdAt: 300,
    };
    // Wire is newest-first: the text row (newer id) precedes the plan row.
    vi.mocked(fetchHistory).mockResolvedValue({
      items: [aiText, aiPlan],
      hasNext: false,
    });

    renderHook(() => useHistory(1), { wrapper: wrapper(store) });

    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history).toHaveLength(1),
    );
    const turn = store.get(activeConversationAtom)?.history[0];
    // Plan part on top, text part below — one card, one timestamp (latest).
    expect(turn?.content).toEqual([
      { partId: "200:0", type: "plan", planId: "9" },
      { partId: "201:0", type: "text", text: "done" },
    ]);
    expect(turn?.createdAt).toBe(300);
  });

  it("an older-page (next) failure keeps rendered history (fetchNextPage error does not throw)", async () => {
    const store = createStore();
    const m100 = aiMessage("100", "newest");
    const m99 = aiMessage("99", "older");
    vi.mocked(fetchHistory)
      .mockResolvedValueOnce({ items: [m100, m99], hasNext: true })
      .mockRejectedValueOnce(new Error("older page boom"));

    const { result } = renderHook(() => useHistory(1), {
      wrapper: wrapper(store),
    });

    await waitFor(() =>
      expect(store.get(activeConversationAtom)?.history).toHaveLength(2),
    );

    await act(async () => {
      result.current.fetchOlder();
    });

    await waitFor(() =>
      expect(vi.mocked(fetchHistory)).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(result.current.isFetchingOlder).toBe(false));

    // The older-page error must NOT blank the page — the already-rendered
    // history is preserved. fetchNextPage errors are caught by react-query
    // and don't throw to the boundary.
    expect(store.get(activeConversationAtom)?.history.map((m) => m.id)).toEqual(
      ["99", "100"],
    );
  });

  it("seeds plansAtom from a history message's inline seedPlan", async () => {
    const store = createStore();
    const plan: Plan = {
      planId: "42",
      status: PlanStatusSchema.enum.COMPLETED,
      title: "Seeded",
      steps: [],
    };
    const msg: Message = {
      id: "300",
      author: "ai",
      turnId: 42,
      content: [{ partId: "300:0", type: "plan", planId: "42" }],
      seedPlan: plan,
    };
    vi.mocked(fetchHistory).mockResolvedValue({ items: [msg], hasNext: false });

    renderHook(() => useHistory(1), { wrapper: wrapper(store) });

    await waitFor(() => expect(store.get(plansAtom).get("42")).toBeDefined());
    expect(store.get(plansAtom).get("42")?.status).toBe(
      PlanStatusSchema.enum.COMPLETED,
    );
  });

  it("does NOT clobber a plan already in plansAtom (seed-if-absent; a live poll wins)", async () => {
    const store = createStore();
    const live: Plan = {
      planId: "42",
      status: PlanStatusSchema.enum.RUNNING,
      title: "Live",
      steps: [],
    };
    store.set(plansAtom, new Map([["42", live]]));
    const stale: Plan = { ...live, title: "Stale seed" };
    const msg: Message = {
      id: "300",
      author: "ai",
      turnId: 42,
      content: [{ partId: "300:0", type: "plan", planId: "42" }],
      seedPlan: stale,
    };
    vi.mocked(fetchHistory).mockResolvedValue({ items: [msg], hasNext: false });

    renderHook(() => useHistory(1), { wrapper: wrapper(store) });

    await waitFor(() => expect(store.get(conversationsAtom).size).toBe(1));
    // The pre-existing live plan is untouched — same reference.
    expect(store.get(plansAtom).get("42")).toBe(live);
  });
});

describe("seedEmptyHistory", () => {
  // Read the key back through the REAL read path (`historyQueryOptions`), not a
  // hand-rolled literal — so if the seed's key ever drifts from the fetch's key,
  // this read misses and the test fails (the whole point of the shared builder).
  const readKey = (
    agentInstanceId: number,
    conversationId: number,
  ): readonly unknown[] =>
    historyQueryOptions(
      agentInstanceId,
      {} as AxiosInstance,
      "/x",
      conversationId,
    ).queryKey;

  it("seeds an empty first page under the history queryKey the fetch reads", () => {
    const qc = new QueryClient();
    seedEmptyHistory(qc, 7, 501);
    expect(qc.getQueryData(readKey(7, 501))).toEqual({
      pages: [{ items: [], hasNext: false }],
      pageParams: [1],
    });
  });

  it("does NOT clobber already-cached history", () => {
    const qc = new QueryClient();
    const real = {
      pages: [{ items: [{ id: "m1" }], hasNext: true }],
      pageParams: [1],
    };
    qc.setQueryData(readKey(7, 501), real);
    seedEmptyHistory(qc, 7, 501);
    // Existing (real) data is preserved, not overwritten with the empty seed.
    expect(qc.getQueryData(readKey(7, 501))).toBe(real);
  });

  it("seeds the empty page as immediately STALE so a remount refetches real history", () => {
    const qc = new QueryClient();
    seedEmptyHistory(qc, 7, 501);
    // The seed only exists to skip the first-mount skeleton flash (data is
    // present → isPending=false). It must NOT stay fresh: messages sent after
    // seeding live only in the jotai store, so a later remount (navigate away +
    // back) must refetch real server history rather than serve this empty page.
    // dataUpdatedAt=0 makes it stale, so refetchOnMount (default) refetches.
    const state = qc.getQueryState(readKey(7, 501));
    expect(state?.dataUpdatedAt).toBe(0);
  });
});
