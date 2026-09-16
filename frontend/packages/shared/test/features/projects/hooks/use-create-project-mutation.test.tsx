import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCreateProjectMutation } from "@/features/projects/hooks/use-create-project-mutation";
import { projectKeys } from "@/features/projects/query-keys";
import * as service from "@/features/projects/services/projects";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/projects");

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
  vi.mocked(service.createProject).mockReset();
});

describe("useCreateProjectMutation", () => {
  it("forwards the create vars to the service", async () => {
    vi.mocked(service.createProject).mockResolvedValue(5);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateProjectMutation(), {
      wrapper: Wrapper,
    });

    const outcome = await result.current.mutateAsync({
      name: "Aurora",
      organizationId: 9,
      description: "d",
    });

    expect(service.createProject).toHaveBeenCalledWith(expect.anything(), {
      name: "Aurora",
      organizationId: 9,
      description: "d",
    });
    expect(outcome).toBe(5);
  });

  it("forwards iconUri (cover URL) to the create service", async () => {
    vi.mocked(service.createProject).mockResolvedValue(5);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateProjectMutation(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      name: "Aurora",
      organizationId: 9,
      iconUri: "https://cdn/x.svg",
    });

    expect(service.createProject).toHaveBeenCalledWith(expect.anything(), {
      name: "Aurora",
      organizationId: 9,
      iconUri: "https://cdn/x.svg",
    });
  });

  it("invalidates project lists without staling detail or asset caches", async () => {
    vi.mocked(service.createProject).mockResolvedValue(5);
    const { Wrapper, queryClient } = makeWrapper();
    const listKey = projectKeys.list({ memberType: 1, pageSize: 20 });
    const detailKey = projectKeys.detail(7);
    const assetsKey = projectKeys.projectAssets(7);
    queryClient.setQueryData(listKey, { pages: [] });
    queryClient.setQueryData(detailKey, { id: 7 });
    queryClient.setQueryData(assetsKey, []);
    const { result } = renderHook(() => useCreateProjectMutation(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ name: "Aurora", organizationId: 9 });

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(assetsKey)?.isInvalidated).toBe(false);
  });
});
