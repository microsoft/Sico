import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import {
  activeConversationAtom,
  activeConversationIdAtom,
  conversationsAtom,
  createFirstConversationIdsAtom,
} from "@/features/chat/atoms/chat-atom";
import { useChat } from "@/features/chat/hooks/use-chat";
import { historyQueryOptions } from "@/features/chat/hooks/use-history";
import { openChatStream } from "@/features/chat/services/chat-stream";
import { refreshConversationStatus } from "@/features/chat/utils/refresh-conversation-status";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import { organizationKeys } from "@/features/organization/query-keys";
import { type OrganizationSummary } from "@/features/organization/schemas/organization";
import { ApiClientProvider } from "@/services/api-client-context";
import {
  removeItemFromLocalStorage,
  SELECTED_ORGANIZATION_ID_LS,
} from "@/utils/local-storage";

vi.mock("@/features/chat/services/chat-stream", () => ({
  openChatStream: vi.fn(
    async (
      _payload: unknown,
      opts: { onOpen?: () => void; onEvent: (e: unknown) => void },
    ) => {
      opts.onOpen?.();
      opts.onEvent({ event: "message", data: { type: 1, content: "hi" } });
      opts.onEvent({ event: "done", data: { timestamp: 1 } });
    },
  ),
}));

vi.mock("@/features/chat/utils/refresh-conversation-status", () => ({
  refreshConversationStatus: vi.fn(),
}));

const apiClient = axios.create({ baseURL: "/api/sico" });

function wrapper(
  store: ReturnType<typeof createStore>,
  queryClient = new QueryClient(),
): (props: PropsWithChildren) => ReactElement {
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

function historyKey(
  agentInstanceId: number,
  conversationId: number,
): readonly unknown[] {
  return historyQueryOptions(agentInstanceId, apiClient, conversationId)
    .queryKey;
}

function seedHistory(queryClient: QueryClient, key: readonly unknown[]): void {
  queryClient.setQueryData(key, {
    pages: [{ items: [], hasNext: false }],
    pageParams: [1],
  });
}

beforeEach(() => {
  removeItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
  vi.clearAllMocks();
});

afterEach(() => {
  removeItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
  vi.restoreAllMocks();
});

describe("useChat", () => {
  it("passes a live bound organization getter to the send transport", async () => {
    const store = createStore();
    const queryClient = new QueryClient();
    store.set(userAtom, { id: 1, email: "user@example.test", roles: [] });
    const organizations: OrganizationSummary[] = [9, 10].map((id) => ({
      id,
      name: `Organization ${id}`,
      description: "",
      createdAt: 1,
      updatedAt: 1,
      creatorUsername: "owner@example.test",
      roleCodes: [],
      isOwner: false,
    }));
    queryClient.setQueryData(
      organizationKeys.userOrganizations(1),
      organizations,
    );
    const { result } = renderHook(() => useChat(1), {
      wrapper: wrapper(store, queryClient),
    });

    await act(async () => {
      await result.current.send("hello", []);
    });
    const options = vi.mocked(openChatStream).mock.calls[0]?.[1];
    expect(options?.getOrganizationId?.()).toBe(9);
    store.set(selectedOrganizationIdAtom, 10);

    expect(options?.getOrganizationId?.()).toBe(10);
    queryClient.clear();
  });

  it("send() runs the turn and ends in done", async () => {
    const store = createStore();
    const { result } = renderHook(() => useChat(1), {
      wrapper: wrapper(store),
    });
    await act(async () => {
      await result.current.send("hello", []);
    });
    await waitFor(() => {
      const conv = store.get(activeConversationAtom);
      expect(conv?.history.at(-1)).toMatchObject({
        author: "ai",
        streamingState: "done",
      });
    });
  });

  it("refreshes status after stream acceptance and again at settlement", async () => {
    const store = createStore();
    let reportOpen = (): void => {
      throw new Error("stream was not started");
    };
    let reportDone = (): void => {
      throw new Error("stream was not started");
    };
    vi.mocked(openChatStream).mockImplementationOnce(
      (_payload, options) =>
        new Promise<void>((resolve) => {
          reportOpen = () => options.onOpen?.();
          reportDone = () => {
            options.onEvent({ event: "done", data: { timestamp: 1 } });
            resolve();
          };
        }),
    );
    const { result } = renderHook(() => useChat(7), {
      wrapper: wrapper(store),
    });
    let sendPromise = Promise.resolve();

    act(() => {
      sendPromise = result.current.send("hello", [], 42);
    });
    expect(refreshConversationStatus).not.toHaveBeenCalled();

    act(() => {
      reportOpen();
    });
    expect(refreshConversationStatus).toHaveBeenCalledOnce();
    expect(refreshConversationStatus).toHaveBeenLastCalledWith(
      expect.any(QueryClient),
      7,
    );

    await act(async () => {
      reportDone();
      await sendPromise;
    });
    expect(refreshConversationStatus).toHaveBeenCalledTimes(2);
  });

  it("done refreshes terminal status once", async () => {
    const store = createStore();
    const queryClient = new QueryClient();
    const conversationA = 99;
    const conversationB = 100;
    const keyA = historyKey(1, conversationA);
    const keyB = historyKey(1, conversationB);
    seedHistory(queryClient, keyA);
    seedHistory(queryClient, keyB);
    store.set(
      createFirstConversationIdsAtom,
      new Set([conversationA, conversationB]),
    );
    const { result } = renderHook(() => useChat(1), {
      wrapper: wrapper(store, queryClient),
    });

    await act(async () => {
      await result.current.send("hello", [], conversationA);
    });

    await waitFor(() =>
      expect(queryClient.getQueryState(keyA)?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(keyB)?.isInvalidated).toBe(false);
    expect(store.get(createFirstConversationIdsAtom)).toEqual(
      new Set([conversationB]),
    );
    expect(refreshConversationStatus).toHaveBeenCalledTimes(2);
  });

  it("pre-open abort invalidates only its history and clears its marker", async () => {
    const store = createStore();
    const queryClient = new QueryClient();
    const conversationA = 101;
    const conversationB = 102;
    const keyA = historyKey(1, conversationA);
    const keyB = historyKey(1, conversationB);
    seedHistory(queryClient, keyA);
    seedHistory(queryClient, keyB);
    store.set(
      createFirstConversationIdsAtom,
      new Set([conversationA, conversationB]),
    );
    vi.mocked(openChatStream).mockImplementationOnce(async () => {
      store.get(activeConversationAtom)?.sendHandle?.abort();
    });
    const { result } = renderHook(() => useChat(1), {
      wrapper: wrapper(store, queryClient),
    });

    await act(async () => {
      await result.current.send("hello", [], conversationA);
    });

    await waitFor(() =>
      expect(queryClient.getQueryState(keyA)?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(keyB)?.isInvalidated).toBe(false);
    expect(store.get(createFirstConversationIdsAtom)).toEqual(
      new Set([conversationB]),
    );
    expect(refreshConversationStatus).not.toHaveBeenCalled();
  });

  it("stop() tears down a text-only turn through the reconnect stop() and the chat handle", async () => {
    const store = createStore();
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
    store.set(
      conversationsAtom,
      new Map([
        [
          "c1",
          {
            clientId: "c1",
            history: [
              {
                id: "ai",
                author: "ai" as const,
                streamingState: "streaming" as const,
                content: [{ partId: "p", type: "text" as const, text: "hi" }],
              },
            ],
            sendHandle: controller,
          },
        ],
      ]),
    );
    store.set(activeConversationIdAtom, "c1");
    const reconnectStop = vi.fn();
    const { result } = renderHook(() => useChat(1), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await result.current.stop(reconnectStop);
    });

    expect(reconnectStop).toHaveBeenCalledOnce();
    expect(abortSpy).toHaveBeenCalledOnce();
  });
});
