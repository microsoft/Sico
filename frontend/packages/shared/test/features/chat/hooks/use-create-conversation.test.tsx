import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pendingTitleConversationIdsAtom } from "@/features/chat/atoms/chat-atom";
import { useCreateConversation } from "@/features/chat/hooks/use-create-conversation";
import * as service from "@/features/chat/services/conversation";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/chat/services/conversation");

function makeWrapper(): {
  Wrapper: (props: { children: ReactNode }) => ReactElement;
  queryClient: QueryClient;
  store: ReturnType<typeof createStore>;
} {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const store = createStore();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </JotaiProvider>
      </QueryClientProvider>
    );
  }

  return { Wrapper, queryClient, store };
}

beforeEach(() => {
  vi.mocked(service.createConversation).mockReset();
});

describe("useCreateConversation", () => {
  it("creates a conversation with the given vars", async () => {
    vi.mocked(service.createConversation).mockResolvedValue({
      id: 501,
      title: "Hi",
      createdAt: undefined,
      agentInstanceId: 7,
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateConversation(), {
      wrapper: Wrapper,
    });

    const created = await result.current.mutateAsync({
      agentInstanceId: 7,
      title: "Hi",
    });

    expect(service.createConversation).toHaveBeenCalledWith(expect.anything(), {
      agentInstanceId: 7,
      title: "Hi",
    });
    expect(created.id).toBe(501);
  });

  it("invalidates the conversation list on success", async () => {
    vi.mocked(service.createConversation).mockResolvedValue({
      id: 501,
      title: "Hi",
      createdAt: undefined,
      agentInstanceId: 7,
    });
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateConversation(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ agentInstanceId: 7 });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["conversations", "list"],
      }),
    );
  });

  it("marks the created id as title-pending so the sidebar polls only it", async () => {
    vi.mocked(service.createConversation).mockResolvedValue({
      id: 501,
      title: "New Session",
      createdAt: undefined,
      agentInstanceId: 7,
    });
    const { Wrapper, store } = makeWrapper();
    const { result } = renderHook(() => useCreateConversation(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ agentInstanceId: 7 });

    expect(store.get(pendingTitleConversationIdsAtom).has(501)).toBe(true);
  });
});
