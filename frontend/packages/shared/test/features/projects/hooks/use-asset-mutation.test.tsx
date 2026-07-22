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
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetDetail } from "@/features/projects/hooks/use-asset-detail-query";
import { useAssetMutation } from "@/features/projects/hooks/use-asset-mutation";
import * as service from "@/features/projects/services/asset-mutations";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/asset-mutations");

// A minimal resolved Knowledge detail as it sits in the asset-detail cache.
function knowledgeDetail(tags: { id: number; name: string }[]): AssetDetail {
  return {
    type: "knowledge",
    id: 10,
    name: "Doc",
    documentType: 1,
    status: 3,
    tags,
    creatorUsername: "alice",
    createdAt: 1,
    summary: "s",
    fullText: "f",
  };
}

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
  vi.mocked(service.editDocument).mockReset();
  vi.mocked(service.deleteDocument).mockReset();
});

describe("useAssetMutation", () => {
  it("edit sends id + name + tagIds[] and invalidates assets", async () => {
    vi.mocked(service.editDocument).mockResolvedValue(10);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useAssetMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.edit.mutateAsync({
      id: 10,
      name: "Renamed",
      tagIds: [1, 2],
    });

    expect(service.editDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 10, name: "Renamed", tagIds: [1, 2] }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "assets", 7],
      }),
    );
  });

  it("edit invalidates the open asset-detail so a retag persists on revisit", async () => {
    vi.mocked(service.editDocument).mockResolvedValue(10);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useAssetMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.edit.mutateAsync({ id: 10, tagIds: [1, 2] });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "asset-detail"],
      }),
    );
  });

  it("edit optimistically writes the new tags into the asset-detail cache", async () => {
    let resolveEdit: (value: number) => void = () => {};
    vi.mocked(service.editDocument).mockReturnValue(
      new Promise<number>((resolve) => {
        resolveEdit = resolve;
      }),
    );
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["projects", "knowledge-tags", 7], {
      items: [
        { id: 1, name: "Refunds" },
        { id: 2, name: "Billing" },
      ],
      total: 2,
      hasNext: false,
    });
    queryClient.setQueryData(
      ["projects", "asset-detail", "knowledge", 10],
      knowledgeDetail([{ id: 1, name: "Refunds" }]),
    );

    const { result } = renderHook(() => useAssetMutation(7), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.edit.mutate({ id: 10, tagIds: [1, 2] });
    });

    // The new chip resolves to its name via the knowledge-tags cache, instantly —
    // before the server (still pending) responds.
    await waitFor(() => {
      const cached = queryClient.getQueryData<AssetDetail>([
        "projects",
        "asset-detail",
        "knowledge",
        10,
      ]);
      expect(cached?.type === "knowledge" ? cached.tags : null).toEqual([
        { id: 1, name: "Refunds" },
        { id: 2, name: "Billing" },
      ]);
    });

    act(() => resolveEdit(10));
  });

  it("edit rolls the asset-detail cache back to the prior tags on error", async () => {
    let rejectEdit: (error: Error) => void = () => {};
    vi.mocked(service.editDocument).mockReturnValue(
      new Promise<number>((_resolve, reject) => {
        rejectEdit = reject;
      }),
    );
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["projects", "knowledge-tags", 7], {
      items: [
        { id: 1, name: "Refunds" },
        { id: 2, name: "Billing" },
      ],
      total: 2,
      hasNext: false,
    });
    queryClient.setQueryData(
      ["projects", "asset-detail", "knowledge", 10],
      knowledgeDetail([{ id: 1, name: "Refunds" }]),
    );

    const { result } = renderHook(() => useAssetMutation(7), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.edit.mutate({ id: 10, tagIds: [1, 2] });
    });
    await waitFor(() => {
      const cached = queryClient.getQueryData<AssetDetail>([
        "projects",
        "asset-detail",
        "knowledge",
        10,
      ]);
      expect(cached?.type === "knowledge" ? cached.tags : null).toEqual([
        { id: 1, name: "Refunds" },
        { id: 2, name: "Billing" },
      ]);
    });

    act(() => rejectEdit(new Error("boom")));

    await waitFor(() => {
      const cached = queryClient.getQueryData<AssetDetail>([
        "projects",
        "asset-detail",
        "knowledge",
        10,
      ]);
      expect(cached?.type === "knowledge" ? cached.tags : null).toEqual([
        { id: 1, name: "Refunds" },
      ]);
    });
  });

  it("delete routes a knowledge row to deleteDocument and invalidates assets", async () => {
    vi.mocked(service.deleteDocument).mockResolvedValue(undefined);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useAssetMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.remove.mutateAsync({ id: 10, type: "knowledge" });

    expect(service.deleteDocument).toHaveBeenCalledWith(expect.anything(), 10);
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "assets", 7],
      }),
    );
  });

  it("delete routes a deliverable row to deleteDeliverable", async () => {
    vi.mocked(service.deleteDeliverable).mockResolvedValue(undefined);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAssetMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.remove.mutateAsync({ id: 22, type: "deliverable" });

    expect(service.deleteDeliverable).toHaveBeenCalledWith(
      expect.anything(),
      22,
    );
    expect(service.deleteDocument).not.toHaveBeenCalled();
  });

  it("delete routes an experience row to deletePlaybook", async () => {
    vi.mocked(service.deletePlaybook).mockResolvedValue(undefined);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAssetMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.remove.mutateAsync({ id: 33, type: "experience" });

    expect(service.deletePlaybook).toHaveBeenCalledWith(expect.anything(), 33);
    expect(service.deleteDocument).not.toHaveBeenCalled();
  });
});
