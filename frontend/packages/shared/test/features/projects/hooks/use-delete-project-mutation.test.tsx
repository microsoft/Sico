import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDeleteProjectMutation } from "@/features/projects/hooks/use-delete-project-mutation";
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
  vi.mocked(service.deleteProject).mockReset().mockResolvedValue(undefined);
});

describe("useDeleteProjectMutation", () => {
  it("calls the delete service with the project id", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteProjectMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync();

    expect(service.deleteProject).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("invalidates the projects prefix on success", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteProjectMutation(7), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync();

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects"],
        exact: false,
      }),
    );
  });
});
