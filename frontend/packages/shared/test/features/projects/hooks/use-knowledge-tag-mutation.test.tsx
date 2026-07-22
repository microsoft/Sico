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
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useKnowledgeTagMutation } from "@/features/projects/hooks/use-knowledge-tag-mutation";
import * as service from "@/features/projects/services/knowledge-tags";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/knowledge-tags");

function makeWrapper(): {
  Wrapper: (props: { children: ReactNode }) => ReactElement;
  queryClient: QueryClient;
} {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  }

  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.mocked(service.createKnowledgeTag).mockReset();
  vi.mocked(service.editKnowledgeTag).mockReset();
  vi.mocked(service.deleteKnowledgeTag).mockReset();
});

describe("useKnowledgeTagMutation", () => {
  it("create invalidates the knowledge-tags key", async () => {
    vi.mocked(service.createKnowledgeTag).mockResolvedValue(99);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useKnowledgeTagMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.create.mutateAsync({
      projectId: 7,
      name: "Refunds",
      description: "d",
    });

    expect(service.createKnowledgeTag).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 7, name: "Refunds" }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "knowledge-tags", 7],
      }),
    );
  });

  it("create optimistically inserts the new tag into the knowledge-tags cache", async () => {
    vi.mocked(service.createKnowledgeTag).mockResolvedValue(99);
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["projects", "knowledge-tags", 7], {
      items: [],
      total: 0,
      hasNext: false,
    });

    const { result } = renderHook(() => useKnowledgeTagMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.create.mutateAsync({
      projectId: 7,
      name: "Refunds",
      description: "d",
    });

    // The new tag is in the cache immediately (id + name correct) so its chip /
    // checked state shows without waiting for the refetch.
    const cached = queryClient.getQueryData<{
      items: { id: number; name: string }[];
    }>(["projects", "knowledge-tags", 7]);
    expect(cached?.items).toContainEqual(
      expect.objectContaining({ id: 99, name: "Refunds" }),
    );
  });

  it("edit invalidates the knowledge-tags key", async () => {
    vi.mocked(service.editKnowledgeTag).mockResolvedValue(1);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useKnowledgeTagMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.edit.mutateAsync({
      id: 1,
      name: "Renamed",
      description: "d",
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "knowledge-tags", 7],
      }),
    );
  });

  it("remove invalidates the knowledge-tags key", async () => {
    vi.mocked(service.deleteKnowledgeTag).mockResolvedValue(undefined);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useKnowledgeTagMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.remove.mutateAsync(1);

    expect(service.deleteKnowledgeTag).toHaveBeenCalledWith(
      expect.anything(),
      1,
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "knowledge-tags", 7],
      }),
    );
  });
});
