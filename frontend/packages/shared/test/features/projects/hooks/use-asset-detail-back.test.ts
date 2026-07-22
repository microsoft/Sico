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

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAssetDetailBack } from "@/features/projects/hooks/use-asset-detail-back";

const { navigateMock, historyBackMock, canGoBackMock, locationStateMock } =
  vi.hoisted(() => ({
    navigateMock: vi.fn(),
    historyBackMock: vi.fn(),
    canGoBackMock: vi.fn(),
    locationStateMock: vi.fn(),
  }));

vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useCanGoBack: () => canGoBackMock(),
    useRouter: () => ({ history: { back: historyBackMock } }),
    useLocation: () => ({ state: locationStateMock() }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no navigation state (the common in-app case).
  locationStateMock.mockReturnValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAssetDetailBack", () => {
  it("goes back through history when there is in-app history", () => {
    canGoBackMock.mockReturnValue(true);
    const { result } = renderHook(() => useAssetDetailBack(7));

    result.current();

    expect(historyBackMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("navigates to the owning project page when there is no history", () => {
    canGoBackMock.mockReturnValue(false);
    const { result } = renderHook(() => useAssetDetailBack(7));

    result.current();

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/project/$projectId",
      params: { projectId: "7" },
    });
    expect(historyBackMock).not.toHaveBeenCalled();
  });

  // A caller that opens the detail page from outside the project (dwp's
  // notification center navigates in with `state: { fromNotification: true }`)
  // wants back to land on the DELIVERABLE LIST — the notification only ever
  // opens a shared deliverable — NOT `history.back()` into whatever page the
  // user was on before the notification, and NOT the project root (the mixed
  // "all" tab), even though in-app history exists (`canGoBack` is true).
  it("navigates to the deliverable list when opened from a notification, ignoring history", () => {
    canGoBackMock.mockReturnValue(true);
    locationStateMock.mockReturnValue({ fromNotification: true });
    const { result } = renderHook(() => useAssetDetailBack(7));

    result.current();

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/project/$projectId/deliverable",
      params: { projectId: "7" },
    });
    expect(historyBackMock).not.toHaveBeenCalled();
  });

  it("still targets the deliverable list from a notification when there is no history", () => {
    canGoBackMock.mockReturnValue(false);
    locationStateMock.mockReturnValue({ fromNotification: true });
    const { result } = renderHook(() => useAssetDetailBack(7));

    result.current();

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/project/$projectId/deliverable",
      params: { projectId: "7" },
    });
    expect(historyBackMock).not.toHaveBeenCalled();
  });
});
