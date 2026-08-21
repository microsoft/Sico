import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSkillDetailQuery } from "@/features/skill/hooks/use-skill-detail-query";
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

describe("useSkillDetailQuery", () => {
  it("loads a skill detail by id", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({
        skill: {
          id: 1,
          agentId: "a",
          name: "S",
          description: "",
          version: "v",
          projectId: 1,
          createdAt: 1,
          updatedAt: 2,
        },
        versions: [],
      }),
    });
    const apiClient = { get } as Partial<AxiosInstance> as AxiosInstance;
    const { result } = renderHook(() => useSkillDetailQuery(1), {
      wrapper: makeWrapper(apiClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.skill.id).toBe(1);
  });
});
