import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { type ReactNode, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  knowledgeTagsQueryOptions,
  useKnowledgeTagsQuery,
} from "@/features/projects/hooks/use-knowledge-tags-query";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import * as service from "@/features/projects/services/knowledge-tags";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/knowledge-tags");

const sampleKnowledgeTag: KnowledgeTag = {
  id: 1,
  projectId: 7,
  name: "Refunds",
  description: "when a customer wants money back",
  creatorUsername: "alice",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
};

function makeWrapper(): (props: { children: ReactNode }) => ReactNode {
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
  vi.mocked(service.fetchKnowledgeTags).mockReset();
});

describe("knowledgeTagsQueryOptions", () => {
  it("builds the key ['projects','knowledge-tags',projectId]", () => {
    const apiClient = {} as AxiosInstance;
    const opts = knowledgeTagsQueryOptions(7, apiClient);
    expect(opts.queryKey).toEqual(["projects", "knowledge-tags", 7]);
  });
});

describe("useKnowledgeTagsQuery", () => {
  it("returns the parsed knowledge tags page", async () => {
    vi.mocked(service.fetchKnowledgeTags).mockResolvedValue({
      items: [sampleKnowledgeTag],
      total: 1,
      hasNext: false,
    });
    const { result } = renderHook(() => useKnowledgeTagsQuery(7), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data.items).toHaveLength(1);
    expect(result.current.data.items[0]?.name).toBe("Refunds");
  });
});
