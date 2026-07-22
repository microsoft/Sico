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

import { useProjectMutation } from "@/features/projects/hooks/use-project-mutation";
import type { ProjectDetail } from "@/features/projects/schemas/project";
import * as service from "@/features/projects/services/projects";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/projects");

const cachedDetail: ProjectDetail = {
  id: 1,
  name: "Old",
  description: "d",
  iconUrl: "",
  memberType: 1,
  agentInstances: [],
  ownerUsername: "alice",
  creatorUsername: "alice",
  operatorAdmins: ["bob", "carol"],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
};

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
  vi.mocked(service.updateProject).mockReset();
});

describe("useProjectMutation — operatorAdmins data-loss guard", () => {
  it("injects the full cached operatorAdmins when the caller omits them", async () => {
    vi.mocked(service.updateProject).mockResolvedValue(1);
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["projects", "detail", 1], cachedDetail);

    const { result } = renderHook(() => useProjectMutation(1), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ name: "New" });

    expect(service.updateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 1,
        name: "New",
        operatorAdmins: ["bob", "carol"],
      }),
    );
  });

  it("invalidates the detail key on success", async () => {
    vi.mocked(service.updateProject).mockResolvedValue(1);
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["projects", "detail", 1], cachedDetail);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useProjectMutation(1), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ name: "New" });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "detail", 1],
      }),
    );
  });
});

describe("useProjectMutation — explicit operatorAdmins override", () => {
  it("sends an operator-add set verbatim", async () => {
    vi.mocked(service.updateProject).mockResolvedValue(1);
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["projects", "detail", 1], cachedDetail);

    const { result } = renderHook(() => useProjectMutation(1), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      operatorAdmins: ["bob", "carol", "dave"],
    });

    expect(service.updateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 1,
        operatorAdmins: ["bob", "carol", "dave"],
      }),
    );
  });

  it("sends an operator-remove set verbatim", async () => {
    vi.mocked(service.updateProject).mockResolvedValue(1);
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["projects", "detail", 1], cachedDetail);

    const { result } = renderHook(() => useProjectMutation(1), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ operatorAdmins: ["bob"] });

    expect(service.updateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 1, operatorAdmins: ["bob"] }),
    );
  });

  it("lets an explicit empty array survive (remove-last-operator, not the cache fallback)", async () => {
    vi.mocked(service.updateProject).mockResolvedValue(1);
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["projects", "detail", 1], cachedDetail);

    const { result } = renderHook(() => useProjectMutation(1), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ operatorAdmins: [] });

    // `[]` is not nullish, so the `?? cached` fallback must NOT fire — the
    // empty set passes through verbatim instead of resurrecting ["bob","carol"].
    expect(service.updateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 1, operatorAdmins: [] }),
    );
  });
});
