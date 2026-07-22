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

import { useAddDeliverableToProject } from "@/features/projects/hooks/use-add-deliverable-to-project";
import * as service from "@/features/projects/services/deliverable";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/deliverable");

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
  vi.mocked(service.addDeliverableToProject).mockReset();
});

describe("useAddDeliverableToProject", () => {
  it("calls the service with the input on mutate", async () => {
    vi.mocked(service.addDeliverableToProject).mockResolvedValue();
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAddDeliverableToProject(), {
      wrapper: Wrapper,
    });

    result.current.mutate({
      projectId: 84,
      agentInstanceId: 601,
      fileUri: "default_space/0/hello.md",
      fileName: "hello.md",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(service.addDeliverableToProject).toHaveBeenCalledWith(
      expect.anything(),
      {
        projectId: 84,
        agentInstanceId: 601,
        fileUri: "default_space/0/hello.md",
        fileName: "hello.md",
      },
    );
  });

  it("invalidates the project's assets cache on success so the new deliverable shows", async () => {
    vi.mocked(service.addDeliverableToProject).mockResolvedValue();
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAddDeliverableToProject(), {
      wrapper: Wrapper,
    });

    result.current.mutate({
      projectId: 84,
      agentInstanceId: 601,
      fileUri: "default_space/0/hello.md",
      fileName: "hello.md",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["projects", "assets", 84],
    });
  });
});
