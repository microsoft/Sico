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
import { renderHook, waitFor } from "@testing-library/react";
import { strToU8, zipSync } from "fflate";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useZipFiles } from "@/features/skill/hooks/use-zip-files";

afterEach(() => vi.restoreAllMocks());

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useZipFiles", () => {
  it("unpacks text entries from the asset zip", async () => {
    const zip = zipSync({ "skill.md": strToU8("# hello") });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(zip, { status: 200 }),
    );
    const { result } = renderHook(() => useZipFiles("https://x/s.zip"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.files).toEqual([
      { path: "skill.md", content: "# hello", kind: "text" },
    ]);
  });

  it("treats a non-zip download as a single file named from the url", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(strToU8("# readme"), { status: 200 }),
    );
    const { result } = renderHook(
      () => useZipFiles("https://x/storage/skill.md?sig=abc"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.files).toEqual([
      { path: "skill.md", content: "# readme", kind: "text" },
    ]);
  });

  it("is idle with no url", () => {
    const { result } = renderHook(() => useZipFiles(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current.files).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
