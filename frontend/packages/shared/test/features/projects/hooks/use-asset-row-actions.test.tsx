/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
