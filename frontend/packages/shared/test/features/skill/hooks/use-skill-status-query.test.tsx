import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  attemptsMade,
  useSkillStatusQuery,
} from "@/features/skill/hooks/use-skill-status-query";
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

describe("useSkillStatusQuery", () => {
  it("resolves the current status when enabled", async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ data: makeOkEnvelope({ status: 2 }) });
    const apiClient = { get } as Partial<AxiosInstance> as AxiosInstance;
    const { result } = renderHook(
      () => useSkillStatusQuery({ id: 1, version: "v", enabled: true }),
      { wrapper: makeWrapper(apiClient) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(2);
  });

  it("does not fetch when disabled", () => {
    const get = vi.fn();
    const apiClient = { get } as Partial<AxiosInstance> as AxiosInstance;
    renderHook(
      () => useSkillStatusQuery({ id: 1, version: "v", enabled: false }),
      {
        wrapper: makeWrapper(apiClient),
      },
    );
    expect(get).not.toHaveBeenCalled();
  });
});

describe("attemptsMade", () => {
  it("counts successful fetches", () => {
    expect(attemptsMade({ dataUpdateCount: 3, fetchFailureCount: 0 })).toBe(3);
  });

  it("counts failures too, so a failing endpoint still reaches the cap", () => {
    // The bug this guards: dataUpdateCount only grows on success, so a status
    // endpoint that errors every poll would never reach the cap and poll
    // forever. Failures must count toward the bound.
    expect(attemptsMade({ dataUpdateCount: 0, fetchFailureCount: 60 })).toBe(
      60,
    );
    expect(attemptsMade({ dataUpdateCount: 5, fetchFailureCount: 7 })).toBe(12);
  });
});
