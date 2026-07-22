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
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAddKnowledgeMutation } from "@/features/projects/hooks/use-add-knowledge-mutation";
import { DocumentTypeSchema } from "@/features/projects/schemas/asset";
import type { UploadArtifact } from "@/features/projects/schemas/asset";
import * as service from "@/features/projects/services/asset-mutations";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/asset-mutations");

const { FILE, LINK } = DocumentTypeSchema.enum;

function artifact(id: number): UploadArtifact {
  return {
    id,
    sasUrl: "https://blob/x",
    uri: "p/1/x.pdf",
    metaInfo: {
      contentType: "application/pdf",
      fileExt: "pdf",
      fileName: "x.pdf",
      fileSize: 1,
      fileType: "document",
    },
  };
}

function file(name: string): File {
  return new File(["data"], name, { type: "application/pdf" });
}

function makeWrapper(): {
  Wrapper: (props: { children: ReactNode }) => ReactElement;
  queryClient: QueryClient;
} {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  }

  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.mocked(service.uploadAsset).mockReset();
  vi.mocked(service.registerDocument).mockReset();
});

describe("useAddKnowledgeMutation", () => {
  it("uploads + registers each file as FILE carrying the selected tagIds, then invalidates assets", async () => {
    vi.mocked(service.uploadAsset).mockImplementation(async (_c, _p, f) =>
      artifact(f.name.length),
    );
    vi.mocked(service.registerDocument).mockResolvedValue(1);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useAddKnowledgeMutation(7), {
      wrapper: Wrapper,
    });

    const outcome = await result.current.mutateAsync({
      files: [file("a.pdf"), file("bb.pdf"), file("ccc.pdf")],
      links: [],
      tagIds: [3, 9],
    });

    expect(service.uploadAsset).toHaveBeenCalledTimes(3);
    expect(service.registerDocument).toHaveBeenCalledTimes(3);
    expect(service.registerDocument).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
      assetId: "a.pdf".length,
      documentType: FILE,
      tagIds: [3, 9],
    });
    expect(outcome.succeeded).toHaveLength(3);
    expect(outcome.failed).toHaveLength(0);
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "assets", 7],
      }),
    );
  });

  it("registers each link as LINK with its linkUrl + tagIds and never uploads a blob", async () => {
    vi.mocked(service.registerDocument).mockResolvedValue(1);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useAddKnowledgeMutation(7), {
      wrapper: Wrapper,
    });

    const outcome = await result.current.mutateAsync({
      files: [],
      links: ["https://example.com/a", "https://example.com/b"],
      tagIds: [5],
    });

    expect(service.uploadAsset).not.toHaveBeenCalled();
    expect(service.registerDocument).toHaveBeenCalledTimes(2);
    expect(service.registerDocument).toHaveBeenCalledWith(expect.anything(), {
      projectId: 7,
      linkUrl: "https://example.com/a",
      documentType: LINK,
      tagIds: [5],
    });
    expect(outcome.succeeded).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(outcome.failed).toHaveLength(0);
  });

  it("submits files and links together in one batch", async () => {
    vi.mocked(service.uploadAsset).mockImplementation(async (_c, _p, f) =>
      artifact(f.name.length),
    );
    vi.mocked(service.registerDocument).mockResolvedValue(1);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useAddKnowledgeMutation(7), {
      wrapper: Wrapper,
    });

    const outcome = await result.current.mutateAsync({
      files: [file("a.pdf")],
      links: ["https://example.com/a"],
      tagIds: [],
    });

    expect(service.uploadAsset).toHaveBeenCalledTimes(1);
    expect(service.registerDocument).toHaveBeenCalledTimes(2);
    expect(outcome.succeeded).toEqual(
      expect.arrayContaining(["a.pdf", "https://example.com/a"]),
    );
    expect(outcome.failed).toHaveLength(0);
  });

  it("one file's upload rejecting still resolves the batch (allSettled, M-3)", async () => {
    vi.mocked(service.uploadAsset).mockImplementation(async (_c, _p, f) => {
      if (f.name === "bad.pdf") {
        throw new Error("upload failed");
      }
      return artifact(f.name.length);
    });
    vi.mocked(service.registerDocument).mockResolvedValue(1);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useAddKnowledgeMutation(7), {
      wrapper: Wrapper,
    });

    const outcome = await result.current.mutateAsync({
      files: [file("good1.pdf"), file("bad.pdf"), file("good2.pdf")],
      links: [],
      tagIds: [],
    });

    expect(outcome.succeeded).toEqual(["good1.pdf", "good2.pdf"]);
    expect(outcome.failed).toEqual(["bad.pdf"]);
  });

  it("one link's registerDocument rejecting still resolves the batch", async () => {
    vi.mocked(service.registerDocument).mockImplementation(async (_c, body) => {
      if (body.linkUrl === "https://bad") {
        throw new Error("register failed");
      }
      return 1;
    });
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useAddKnowledgeMutation(7), {
      wrapper: Wrapper,
    });

    const outcome = await result.current.mutateAsync({
      files: [],
      links: ["https://good1", "https://bad", "https://good2"],
      tagIds: [],
    });

    expect(outcome.succeeded).toEqual(["https://good1", "https://good2"]);
    expect(outcome.failed).toEqual(["https://bad"]);
  });
});
