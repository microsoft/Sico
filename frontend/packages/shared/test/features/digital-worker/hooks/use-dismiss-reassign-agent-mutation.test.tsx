import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDismissAgentMutation } from "@/features/digital-worker/hooks/use-dismiss-agent-mutation";
import { useReassignAgentMutation } from "@/features/digital-worker/hooks/use-reassign-agent-mutation";
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

beforeEach(() => {
  vi.mocked(service.dismissAgentInstance).mockReset().mockResolvedValue();
  vi.mocked(service.reassignAgentInstance).mockReset().mockResolvedValue();
});

describe("useDismissAgentMutation", () => {
  it("forwards the id to the dismiss service", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDismissAgentMutation(), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({ id: 9 });
    expect(service.dismissAgentInstance).toHaveBeenCalledWith(
      expect.anything(),
      { id: 9 },
    );
  });

  it("invalidates the agents list on success", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDismissAgentMutation(), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({ id: 9 });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        queryKey: ["agents", "list"],
        exact: false,
      }),
    );
  });
});

describe("useReassignAgentMutation", () => {
  it("forwards id + new operator to the reassign service", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useReassignAgentMutation(), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({ id: 9, newOperatorUsername: "a@b.com" });
    expect(service.reassignAgentInstance).toHaveBeenCalledWith(
      expect.anything(),
      { id: 9, newOperatorUsername: "a@b.com" },
    );
  });
});
