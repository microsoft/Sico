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
