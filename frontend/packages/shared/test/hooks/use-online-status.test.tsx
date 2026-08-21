import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOnlineStatus } from "@/hooks/use-online-status";

import { fireNetworkStatus } from "../helpers/network";

describe("useOnlineStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns navigator.onLine initially", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("updates on offline/online events", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const { result } = renderHook(() => useOnlineStatus());
    act(() => {
      fireNetworkStatus(false);
    });
    expect(result.current).toBe(false);
    act(() => {
      fireNetworkStatus(true);
    });
    expect(result.current).toBe(true);
  });

  it("removes both listeners on unmount", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useOnlineStatus());

    const addedOnline = addSpy.mock.calls.filter(([type]) => type === "online");
    const addedOffline = addSpy.mock.calls.filter(
      ([type]) => type === "offline",
    );
    expect(addedOnline).toHaveLength(1);
    expect(addedOffline).toHaveLength(1);

    unmount();

    const removedOnline = removeSpy.mock.calls.filter(
      ([type]) => type === "online",
    );
    const removedOffline = removeSpy.mock.calls.filter(
      ([type]) => type === "offline",
    );
    expect(removedOnline).toHaveLength(1);
    expect(removedOffline).toHaveLength(1);
    // The `[0]![1]` indexes are non-null because the
    // `expect(...).toHaveLength(1)` guards above already proved both
    // arrays have exactly one entry and that entry is a
    // `[type, handler]` tuple. The `!` collapses the redundant
    // null-check; if the length-assertions ever loosened, the
    // assertion below would still catch the regression at runtime.
    expect(addedOnline[0]![1]).toBe(removedOnline[0]![1]);
    expect(addedOffline[0]![1]).toBe(removedOffline[0]![1]);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
