import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { type ReactNode, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assetDetailQueryOptions,
  resolveAssetDetailGuard,
  useAssetDetailQuery,
} from "@/features/projects/hooks/use-asset-detail-query";
import type {
  DocumentDetails,
  KnowledgeDocument,
  PlaybookDetails,
} from "@/features/projects/schemas/asset";
import * as service from "@/features/projects/services/assets";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/projects/services/assets");

const sampleDoc: KnowledgeDocument = {
  id: 10,
  name: "spec.pdf",
  documentType: 1,
  status: 3,
  failReason: null,
  tags: [],
  assetId: 99,
  sourceFile: "spec.pdf",
  linkUrl: null,
  creatorUsername: "alice",
  createdAt: 1_700_000_000_000,
};
const sampleDocDetails: DocumentDetails = { summary: "s", fullText: "f" };
const samplePlaybookDetails: PlaybookDetails = {
  content: "c",
  name: "refund playbook",
};

function makeWrapper(): (props: { children: ReactNode }) => ReactNode {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <Suspense fallback={null}>{children}</Suspense>
        </ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.mocked(service.fetchKnowledgeDocument).mockReset();
  vi.mocked(service.fetchDocumentDetails).mockReset();
  vi.mocked(service.fetchPlaybookDetails).mockReset();
});

describe("assetDetailQueryOptions", () => {
  it("builds the key ['projects','asset-detail',type,id]", () => {
    const apiClient = {} as AxiosInstance;
    expect(
      assetDetailQueryOptions({ id: 10, type: "knowledge" }, apiClient)
        .queryKey,
    ).toEqual(["projects", "asset-detail", "knowledge", 10]);
    expect(
      assetDetailQueryOptions({ id: 5, type: "experience" }, apiClient)
        .queryKey,
    ).toEqual(["projects", "asset-detail", "experience", 5]);
  });
});

describe("resolveAssetDetailGuard", () => {
  it("maps undefined / status to not-found / redirect / ok", () => {
    expect(resolveAssetDetailGuard(undefined)).toBe("not-found");
    expect(resolveAssetDetailGuard({ status: 2 })).toBe("redirect");
    expect(resolveAssetDetailGuard({ status: 3 })).toBe("ok");
    // Experience rows carry no status → always viewable.
    expect(resolveAssetDetailGuard({})).toBe("ok");
  });
});

describe("useAssetDetailQuery", () => {
  it("knowledge: merges the document row with its details body", async () => {
    vi.mocked(service.fetchKnowledgeDocument).mockResolvedValue(sampleDoc);
    vi.mocked(service.fetchDocumentDetails).mockResolvedValue(sampleDocDetails);

    const { result } = renderHook(
      () => useAssetDetailQuery({ id: 10, type: "knowledge" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    const data = result.current.data;
    expect(data.type).toBe("knowledge");
    if (data.type === "knowledge") {
      expect(data.status).toBe(3);
      expect(data.name).toBe("spec.pdf");
      expect(data.summary).toBe("s");
      expect(data.fullText).toBe("f");
    }
  });

  it("experience: returns the playbook details body", async () => {
    vi.mocked(service.fetchPlaybookDetails).mockResolvedValue(
      samplePlaybookDetails,
    );

    const { result } = renderHook(
      () => useAssetDetailQuery({ id: 5, type: "experience" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    const data = result.current.data;
    expect(data.type).toBe("experience");
    if (data.type === "experience") {
      expect(data.content).toBe("c");
      expect(data.name).toBe("refund playbook");
    }
    expect(service.fetchKnowledgeDocument).not.toHaveBeenCalled();
  });
});
