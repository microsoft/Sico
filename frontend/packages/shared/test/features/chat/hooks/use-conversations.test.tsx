import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useConversations } from "@/features/chat/hooks/use-conversations";
import type { ConversationSummary } from "@/features/chat/schemas/conversation";
import * as service from "@/features/chat/services/conversation";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/chat/services/conversation");

function conv(id: number): ConversationSummary {
  return { id, title: `C${id}`, createdAt: id, agentInstanceId: 7 };
}

function makeWrapper(): (props: { children: ReactNode }) => ReactElement {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.mocked(service.listConversations).mockReset();
});

describe("useConversations", () => {
  it("fetches the first page for the given agentInstanceId (page 1)", async () => {
    vi.mocked(service.listConversations).mockResolvedValue({
      items: [],
      hasNext: false,
    });
    const { result } = renderHook(() => useConversations(7), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.items).toBeDefined());
    // agentInstanceId + page 1 flow through to the service.
    expect(service.listConversations).toHaveBeenCalledWith(
      expect.anything(),
      7,
      1,
    );
  });

  it("flattens the fetched page into items and exposes hasNextPage", async () => {
    vi.mocked(service.listConversations).mockResolvedValue({
      items: [conv(1)],
      hasNext: true,
    });
    const { result } = renderHook(() => useConversations(7), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.title).toBe("C1");
    expect(result.current.hasNextPage).toBe(true);
  });

  it("appends the next page's items on fetchNextPage, requesting page 2", async () => {
    vi.mocked(service.listConversations)
      .mockResolvedValueOnce({ items: [conv(1)], hasNext: true })
      .mockResolvedValueOnce({ items: [conv(2)], hasNext: false });
    const { result } = renderHook(() => useConversations(7), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    // Newest-first pages append in fetch order: page 1 then page 2.
    expect(result.current.items.map((c) => c.id)).toEqual([1, 2]);
    expect(result.current.hasNextPage).toBe(false);
    expect(service.listConversations).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      7,
      2,
    );
  });

  it("does not advance past the last page (hasNextPage false stops fetching)", async () => {
    vi.mocked(service.listConversations).mockResolvedValue({
      items: [conv(1)],
      hasNext: false,
    });
    const { result } = renderHook(() => useConversations(7), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(false);
  });
});
