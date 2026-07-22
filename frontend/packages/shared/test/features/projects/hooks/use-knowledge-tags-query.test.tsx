/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
