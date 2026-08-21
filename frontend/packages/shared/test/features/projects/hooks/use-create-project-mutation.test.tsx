import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCreateProjectMutation } from "@/features/projects/hooks/use-create-project-mutation";
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
      description: "d",
    });

    expect(service.createProject).toHaveBeenCalledWith(expect.anything(), {
      name: "Aurora",
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
      iconUri: "https://cdn/x.svg",
    });

    expect(service.createProject).toHaveBeenCalledWith(expect.anything(), {
      name: "Aurora",
      iconUri: "https://cdn/x.svg",
    });
  });

  it("invalidates the projects prefix on success", async () => {
    vi.mocked(service.createProject).mockResolvedValue(5);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateProjectMutation(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ name: "Aurora" });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects"],
        exact: false,
      }),
    );
  });
});
