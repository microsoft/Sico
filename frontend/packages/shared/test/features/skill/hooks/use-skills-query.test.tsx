import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSkillsQuery } from "@/features/skill/hooks/use-skills-query";
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

describe("useSkillsQuery", () => {
  it("loads the skills page for an agent", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({
        skills: [
          {
            id: 1,
            agentId: "a",
            name: "S",
            description: "",
            version: "v",
            status: 2,
            assetId: 1,
            creatorUsername: "",
            failReason: "",
            projectId: 1,
            createdAt: 1,
            updatedAt: "2",
          },
        ],
        total: 1,
        hasNext: false,
      }),
    });
    const apiClient = { get } as Partial<AxiosInstance> as AxiosInstance;
    const { result } = renderHook(() => useSkillsQuery({ agentId: "a" }), {
      wrapper: makeWrapper(apiClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.id).toBe(1);
  });
});
