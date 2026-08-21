import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { type ReactNode, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assetsInfiniteQueryOptions,
  useAssetsInfiniteQuery,
  useSuspenseAssetsInfiniteQuery,
} from "@/features/projects/hooks/use-assets-query";
import * as service from "@/features/projects/services/assets";
import type { AssetRow } from "@/features/projects/types";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/assets");

// The service now returns client `AssetRow`s (the wire→client mapping lives in
// its envelope transforms, covered by services/assets.test.ts). The hooks only
// orchestrate the query/pagination, so these fixtures are client rows.
const knowledgeRow: AssetRow = {
  type: "knowledge",
  id: 10,
  name: "spec.pdf",
  documentType: 1,
  status: 3,
  failReason: null,
  tags: [],
  assetId: 99,
  sourceFile: "spec.pdf",
  linkUrl: null,
  createdAt: 1_700_000_000_000,
  creator: { kind: "user", username: "alice" },
};

const deliverableRow: AssetRow = {
  type: "deliverable",
  id: 7,
  name: "report.md",
  createdAt: 1_700_000_002_000,
  fileSasUrl: "https://sas/report.md",
  creator: {
    kind: "agent",
    agentInstanceId: 42,
    agentName: "Max",
    iconUrl: "/icons/max.svg",
  },
};

function makeWrapper(): (props: { children: ReactNode }) => ReactNode {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The Suspense boundary is required by `useSuspenseAssetsInfiniteQuery` (it
  // throws the pending promise on first render) and harmless for the
  // non-suspense `useAssetsInfiniteQuery`, so both surfaces share one wrapper.
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
  vi.mocked(service.fetchDocuments).mockReset();
  vi.mocked(service.fetchPlaybooks).mockReset();
  vi.mocked(service.fetchDeliverables).mockReset();
  vi.mocked(service.fetchKnowledgeItems).mockReset();
});

describe("assetsInfiniteQueryOptions", () => {
  it("builds the key ['projects','assets',projectId,category]", () => {
    const opts = assetsInfiniteQueryOptions(
      1,
      "knowledge",
      {} as AxiosInstance,
    );
    expect(opts.queryKey).toEqual(["projects", "assets", 1, "knowledge"]);
    expect(opts.initialPageParam).toBe(1);
  });
});

describe("useSuspenseAssetsInfiniteQuery", () => {
  it("knowledge: flattens the fetched page into rows", async () => {
    vi.mocked(service.fetchDocuments).mockResolvedValue({
      items: [knowledgeRow],
      total: 1,
      hasNext: false,
    });

    const { result } = renderHook(
      () => useSuspenseAssetsInfiniteQuery(1, "knowledge"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    const rows = result.current.data.pages.flatMap((page) => page.items);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("knowledge");
  });

  it("routes each category to its matching service fetcher", async () => {
    vi.mocked(service.fetchDeliverables).mockResolvedValue({
      items: [deliverableRow],
      total: 1,
      hasNext: false,
    });

    const { result } = renderHook(
      () => useSuspenseAssetsInfiniteQuery(1, "deliverable"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(vi.mocked(service.fetchDeliverables)).toHaveBeenCalled();
    expect(vi.mocked(service.fetchDocuments)).not.toHaveBeenCalled();
    const rows = result.current.data.pages.flatMap((page) => page.items);
    expect(rows[0]?.type).toBe("deliverable");
  });

  it("paginates: fetchNextPage appends page 2 and clears hasNextPage at the end", async () => {
    vi.mocked(service.fetchDocuments)
      .mockResolvedValueOnce({
        items: [{ ...knowledgeRow, id: 1 }],
        total: 2,
        hasNext: true,
      })
      .mockResolvedValueOnce({
        items: [{ ...knowledgeRow, id: 2 }],
        total: 2,
        hasNext: false,
      });

    const { result } = renderHook(
      () => useSuspenseAssetsInfiniteQuery(1, "knowledge"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.data.pages).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.data.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    expect(vi.mocked(service.fetchDocuments)).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ page: 1 }),
    );
    expect(vi.mocked(service.fetchDocuments)).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ page: 2 }),
    );
  });
});

describe("useAssetsInfiniteQuery (sentinel surface)", () => {
  it("exposes hasNextPage from the envelope for the scroll sentinel", async () => {
    // The non-suspense surface feeds the infinite-scroll sentinel; it shares the
    // same cache entry as the suspense hook and exposes ONLY pagination state.
    vi.mocked(service.fetchDocuments).mockResolvedValue({
      items: [knowledgeRow],
      total: 2,
      hasNext: true,
    });

    const { result } = renderHook(
      () => useAssetsInfiniteQuery(1, "knowledge"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(result.current.isFetchingNextPage).toBe(false);
    expect(result.current.fetchNextPage).toBeTypeOf("function");
  });
});
