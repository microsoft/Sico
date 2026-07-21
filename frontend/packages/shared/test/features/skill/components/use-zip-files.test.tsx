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
