import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssetRowActions } from "@/features/projects/hooks/use-asset-row-actions";
import type { AssetRow, DeliverableRow } from "@/features/projects/types";
import { ApiClientProvider } from "@/services/api-client-context";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

function makeDeliverable(partial: Partial<DeliverableRow> = {}): AssetRow {
  return {
    type: "deliverable",
    id: 303,
    name: "report.md",
    createdAt: 0,
    fileSasUrl: "https://sas/report.md",
    creator: { kind: "agent", agentInstanceId: 7 },
    ...partial,
  };
}

function makeWrapper(): (props: { children: ReactNode }) => ReactElement {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAssetRowActions", () => {
  it("deletingType reflects the kind of the row being deleted", () => {
    const { result } = renderHook(() => useAssetRowActions(1), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.handleAction(makeDeliverable(), "delete"));

    expect(result.current.deletingType).toBe("deliverable");
  });

  it("deletingType keeps the last target's kind after the dialog closes", () => {
    const { result } = renderHook(() => useAssetRowActions(1), {
      wrapper: makeWrapper(),
    });

    // Open the confirm for a deliverable, then close it. `deletingAsset` clears
    // synchronously, but the ConfirmDialog fades out over ~100ms.
    act(() => result.current.handleAction(makeDeliverable(), "delete"));
    act(() => result.current.closeDelete());

    // The target is gone, but the copy-driving kind must NOT snap back to the
    // "knowledge" fallback — that would flash the wrong title during the fade.
    expect(result.current.deletingAsset).toBeUndefined();
    expect(result.current.deletingType).toBe("deliverable");
  });
});
