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
