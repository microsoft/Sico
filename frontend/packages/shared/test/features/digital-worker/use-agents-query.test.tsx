import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_AGENTS_PAGE_SIZE } from "@/features/digital-worker/constants";
import {
  AGENTS_QUERY_KEY_PREFIX,
  selectDedupedAgents,
  useAgentsQuery,
  useDedupedAgents,
} from "@/features/digital-worker/hooks/use-agents-query";
import type { Agent } from "@/features/digital-worker/schemas/agent";
import { makeOkEnvelope } from "@/schemas/api";
import type { Paged } from "@/schemas/paginated";
import { ApiClientProvider } from "@/services/api-client-context";

function makeClient(get: ReturnType<typeof vi.fn>): AxiosInstance {
  return { get } as Partial<AxiosInstance> as AxiosInstance;
}

function makeAgent(over: Partial<Agent> & Pick<Agent, "id" | "name">): Agent {
  return {
    iconUri: undefined,
    employerIconUri: undefined,
    ...over,
  };
}

function makeWrapper(apiClient: AxiosInstance) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

describe("useAgentsQuery", () => {
  it("exports a stable query key prefix", () => {
    expect(AGENTS_QUERY_KEY_PREFIX).toEqual(["agents", "list"]);
  });

  it("fetches the first page and parses items", async () => {
    const page = {
      instances: [{ id: 1, name: "Alpha" }],
      total: 1,
      hasNext: false,
    };
    const get = vi.fn().mockResolvedValue({ data: makeOkEnvelope(page) });
    const { result } = renderHook(() => useAgentsQuery(), {
      wrapper: makeWrapper(makeClient(get)),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items).toHaveLength(1);
    expect(get).toHaveBeenCalledWith("/agent/single_agent_instances", {
      params: {
        isEmployer: false,
        page: 1,
        pageSize: DEFAULT_AGENTS_PAGE_SIZE,
      },
    });
    // Short page → no next page.
    expect(result.current.hasNextPage).toBe(false);
  });

  it("surfaces schema validation failure as isError", async () => {
    // Schema errors land in `query.isError` so consumers can branch
    // on `useDwPreview().status === "error"` without an ErrorBoundary.
    const bad = {
      instances: [{ id: 1, name: 123 }],
      total: 1,
      hasNext: false,
    };
    const get = vi.fn().mockResolvedValue({ data: makeOkEnvelope(bad) });
    const { result } = renderHook(() => useAgentsQuery(), {
      wrapper: makeWrapper(makeClient(get)),
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe("useAgentsQuery — infinite", () => {
  it("derives hasNextPage from the last page's hasNext (full → short)", async () => {
    const fullInstances = Array.from(
      { length: DEFAULT_AGENTS_PAGE_SIZE },
      (_, i) => ({
        id: i + 1,
        name: `Agent ${i + 1}`,
      }),
    );
    const shortInstances = [{ id: 999, name: "Tail" }];
    const get = vi.fn().mockImplementation((_url, options) => {
      const page = options?.params?.page as number;
      const body =
        page === 1
          ? { instances: fullInstances, total: 100, hasNext: true }
          : { instances: shortInstances, total: 100, hasNext: false };
      return Promise.resolve({ data: makeOkEnvelope(body) });
    });

    const { result } = renderHook(() => useAgentsQuery(), {
      wrapper: makeWrapper(makeClient(get)),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // First page was full → hasNextPage true.
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(2);
    });
    // Second page was short → no more pages.
    expect(result.current.hasNextPage).toBe(false);
    expect(get).toHaveBeenNthCalledWith(2, "/agent/single_agent_instances", {
      params: {
        isEmployer: false,
        page: 2,
        pageSize: DEFAULT_AGENTS_PAGE_SIZE,
      },
    });
  });

  it("preserves backend page order (no client re-sort) via selectDedupedAgents", () => {
    const pages: Paged<Agent>[] = [
      {
        items: [
          makeAgent({ id: 1, name: "Old", updatedAt: 1704067200000 }),
          makeAgent({ id: 2, name: "NoDate" }),
        ],
        total: 2,
        hasNext: false,
      },
      {
        items: [
          makeAgent({ id: 3, name: "New", updatedAt: 1748736000000 }),
          makeAgent({ id: 4, name: "Mid", updatedAt: 1733011200000 }),
        ],
        total: 2,
        hasNext: false,
      },
    ];
    // Order follows the backend's pagination, NOT updatedAt — a later page
    // never jumps ahead of an already-rendered earlier page.
    const result = selectDedupedAgents(pages);
    expect(result.map((a) => a.id)).toEqual([1, 2, 3, 4]);
  });

  it("dedupes by id with last-write-wins across pages", () => {
    const pages: Paged<Agent>[] = [
      {
        items: [
          makeAgent({ id: 1, name: "OldName", updatedAt: 1704067200000 }),
          makeAgent({ id: 2, name: "Two", updatedAt: 1700000000000 }),
        ],
        total: 2,
        hasNext: true,
      },
      {
        items: [
          makeAgent({ id: 1, name: "NewName", updatedAt: 1748736000000 }),
        ],
        total: 1,
        hasNext: false,
      },
    ];
    const result = selectDedupedAgents(pages);
    expect(result).toHaveLength(2);
    const one = result.find((a) => a.id === 1);
    expect(one?.name).toBe("NewName");
    expect(one?.updatedAt).toBe(1748736000000);
  });

  it("useDedupedAgents memoises across renders with same pages", () => {
    const pages: Paged<Agent>[] = [
      {
        items: [makeAgent({ id: 1, name: "A", updatedAt: 1 })],
        total: 1,
        hasNext: false,
      },
    ];
    const { result, rerender } = renderHook(({ p }) => useDedupedAgents(p), {
      initialProps: { p: pages },
    });
    const first = result.current;
    rerender({ p: pages });
    expect(result.current).toBe(first);
    rerender({ p: [...pages] });
    expect(result.current).not.toBe(first);
  });
});

describe("useAgentsQuery — query policy", () => {
  it("pins refetchOnWindowFocus=false, gcTime=5min, staleTime=30s", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({ instances: [], total: 0, hasNext: false }),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function Wrapper({ children }: { children: ReactNode }): ReactNode {
      const apiClient = makeClient(get);
      return (
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(() => useAgentsQuery(), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const cached = queryClient
      .getQueryCache()
      .findAll({ queryKey: AGENTS_QUERY_KEY_PREFIX })[0];
    const options = cached?.options as {
      refetchOnWindowFocus?: boolean;
      gcTime?: number;
      staleTime?: number;
    };
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.gcTime).toBe(5 * 60_000);
    expect(options.staleTime).toBe(30_000);
  });
});
