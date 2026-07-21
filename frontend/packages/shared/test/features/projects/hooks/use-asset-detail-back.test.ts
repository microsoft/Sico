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
