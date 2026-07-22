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
import { describe, expect, it, vi } from "vitest";

import { useAgentsQuery } from "@/features/digital-worker/hooks/use-agents-query";
import { useDwPreview } from "@/features/sidebar/hooks/use-dw-preview";

vi.mock("@/features/digital-worker/hooks/use-agents-query", () => ({
  useAgentsQuery: vi.fn(),
}));

const mockQuery = (overrides: Record<string, unknown>): void => {
  vi.mocked(useAgentsQuery).mockReturnValue(overrides as never);
};

describe("useDwPreview", () => {
  it("returns pending when query is pending", () => {
    mockQuery({ isPending: true, isError: false, data: undefined });
    const { result } = renderHook(() => useDwPreview());
    expect(result.current).toEqual({ status: "pending" });
  });

  it("returns error when query is in error state", () => {
    mockQuery({ isPending: false, isError: true, data: undefined });
    const { result } = renderHook(() => useDwPreview());
    expect(result.current).toEqual({ status: "error" });
  });

  it("caps items at DW_PREVIEW (5)", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: `a${i}`,
      role: "r",
      iconUri: "",
    }));
    mockQuery({
      isPending: false,
      isError: false,
      data: { pages: [{ items }] },
    });
    const { result } = renderHook(() => useDwPreview());
    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      expect(result.current.items).toHaveLength(5);
    }
  });

  it("returns ready with empty items when no agents", () => {
    mockQuery({
      isPending: false,
      isError: false,
      data: { pages: [{ items: [] }] },
    });
    const { result } = renderHook(() => useDwPreview());
    expect(result.current).toEqual({ status: "ready", items: [] });
  });
});
