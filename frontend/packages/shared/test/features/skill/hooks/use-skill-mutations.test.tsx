import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDeleteSkillMutation } from "@/features/skill/hooks/use-skill-mutations";
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

describe("useDeleteSkillMutation", () => {
  it("calls deleteSkill and resolves", async () => {
    const del = vi.fn().mockResolvedValue({ data: { code: 0, msg: "ok" } });
    const apiClient = {
      delete: del,
    } as Partial<AxiosInstance> as AxiosInstance;
    const { result } = renderHook(() => useDeleteSkillMutation(), {
      wrapper: makeWrapper(apiClient),
    });
    await act(async () => {
      await result.current.mutateAsync(9);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(del).toHaveBeenCalledWith("/skills", { params: { id: 9 } });
  });
});
