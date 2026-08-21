import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCreateAgentInstanceMutation } from "@/features/digital-worker/hooks/use-create-agent-mutation";
import * as service from "@/features/digital-worker/services/agents";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/digital-worker/services/agents");

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

const created = { id: 9, agentId: "tmpl-1", employerUsername: "a@b.com" };

beforeEach(() => {
  vi.mocked(service.createAgentInstance).mockReset();
});

describe("useCreateAgentInstanceMutation", () => {
  it("forwards the create input (incl. projectId) to the service", async () => {
    vi.mocked(service.createAgentInstance).mockResolvedValue(created);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateAgentInstanceMutation(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      agentId: "tmpl-1",
      employerUsername: "a@b.com",
      name: "Nova",
      projectId: 7,
    });

    expect(service.createAgentInstance).toHaveBeenCalledWith(
      expect.anything(),
      {
        agentId: "tmpl-1",
        employerUsername: "a@b.com",
        name: "Nova",
        projectId: 7,
      },
    );
  });

  it("invalidates the agents list prefix on success", async () => {
    vi.mocked(service.createAgentInstance).mockResolvedValue(created);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateAgentInstanceMutation(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      agentId: "tmpl-1",
      employerUsername: "a@b.com",
      name: "Nova",
      projectId: 7,
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["agents", "list"],
        exact: false,
      }),
    );
  });
});
