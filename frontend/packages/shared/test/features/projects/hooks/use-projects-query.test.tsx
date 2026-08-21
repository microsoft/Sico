import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { type ReactNode, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  projectsQueryOptions,
  useProjectsInfiniteQuery,
} from "@/features/projects/hooks/use-projects-query";
import * as service from "@/features/projects/services/projects";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/projects");

function makeWrapper() {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <Suspense fallback={null}>{children}</Suspense>
        </ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.mocked(service.fetchProjects).mockReset();
});

describe("projectsQueryOptions", () => {
  it("builds a stable queryKey including memberType + pageSize", () => {
    const apiClient = {} as AxiosInstance;
    const opts = projectsQueryOptions(
      { memberType: 3, pageSize: 50 },
      apiClient,
    );
    expect(opts.queryKey).toEqual([
      "projects",
      "list",
      { memberType: 3, pageSize: 50 },
    ]);
    expect(opts.initialPageParam).toBe(1);
  });
});

describe("useProjectsInfiniteQuery", () => {
  it("returns parsed pages and computes hasNextPage from envelope", async () => {
    vi.mocked(service.fetchProjects).mockResolvedValue({
      items: [],
      total: 0,
      hasNext: true,
    });
    const { result } = renderHook(() => useProjectsInfiniteQuery(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.hasNextPage).toBe(true);
  });

  it("fetchNextPage requests the next page and stops when hasNext is false", async () => {
    vi.mocked(service.fetchProjects)
      .mockResolvedValueOnce({
        items: [{ id: 1 } as never],
        total: 2,
        hasNext: true,
      })
      .mockResolvedValueOnce({
        items: [{ id: 2 } as never],
        total: 2,
        hasNext: false,
      });
    const { result } = renderHook(() => useProjectsInfiniteQuery(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data.pages).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data.pages).toHaveLength(2));

    expect(result.current.hasNextPage).toBe(false);
    expect(vi.mocked(service.fetchProjects)).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ page: 1 }),
    );
    expect(vi.mocked(service.fetchProjects)).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ page: 2 }),
    );
  });
});
