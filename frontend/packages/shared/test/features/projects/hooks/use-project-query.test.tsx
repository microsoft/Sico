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
  projectDetailQueryOptions,
  useProjectDetailQuery,
} from "@/features/projects/hooks/use-project-query";
import type { ProjectDetail } from "@/features/projects/schemas/project";
import * as service from "@/features/projects/services/projects";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/projects");

const sampleDetail: ProjectDetail = {
  id: 1,
  name: "Atlas",
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
  vi.mocked(service.fetchProjectDetail).mockReset();
});

describe("projectDetailQueryOptions", () => {
  it("builds the detail key ['projects','detail',id]", () => {
    const apiClient = {} as AxiosInstance;
    const opts = projectDetailQueryOptions(1, apiClient);
    expect(opts.queryKey).toEqual(["projects", "detail", 1]);
  });
});

describe("useProjectDetailQuery", () => {
  it("returns the parsed detail", async () => {
    vi.mocked(service.fetchProjectDetail).mockResolvedValue(sampleDetail);
    const { result } = renderHook(() => useProjectDetailQuery(1), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data.operatorAdmins).toEqual(["bob", "carol"]);
    expect(service.fetchProjectDetail).toHaveBeenCalledWith(
      expect.anything(),
      1,
    );
  });
});
