import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useAgentInfosQuery } from "@/features/studio/hooks/use-agent-infos-query";
import { makeOkEnvelope } from "@/schemas/api";
import { ApiClientProvider } from "@/services/api-client-context";

function makeWrapper(apiClient: AxiosInstance) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

describe("useAgentInfosQuery", () => {
  it("loads the studio agent cards", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({
        agentInfos: [{ agentId: "1", name: "Atlas" }],
      }),
    });
    const apiClient = { get } as Partial<AxiosInstance> as AxiosInstance;
    const { result } = renderHook(() => useAgentInfosQuery(), {
      wrapper: makeWrapper(apiClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ agentId: "1", name: "Atlas" }]);
  });
});
