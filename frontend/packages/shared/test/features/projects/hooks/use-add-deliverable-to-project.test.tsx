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
