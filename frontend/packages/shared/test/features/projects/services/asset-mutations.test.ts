import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteDeliverable,
  deleteDocument,
  deletePlaybook,
  editDocument,
  registerDocument,
  uploadAsset,
} from "@/features/projects/services/asset-mutations";
import { makeOkEnvelope } from "@/schemas/api";

function makeClient(
  post: ReturnType<typeof vi.fn>,
  put: ReturnType<typeof vi.fn>,
  del: ReturnType<typeof vi.fn>,
): AxiosInstance {
  return {
    post,
    put,
    delete: del,
  } as Partial<AxiosInstance> as AxiosInstance;
}

const sampleArtifact = {
  id: 5,
  sasUrl: "https://sas",
  uri: "/storage/5",
  metaInfo: {
    contentType: "application/pdf",
    fileExt: "pdf",
    fileName: "spec.pdf",
    fileSize: 1024,
    fileType: "document",
  },
};

const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const apiClient = makeClient(post, put, del);

beforeEach(() => {
  post.mockReset();
  put.mockReset();
  del.mockReset();
});

describe("registerDocument", () => {
  it("POSTs /knowledge/document with the exact body and returns the id", async () => {
    post.mockResolvedValue({ data: makeOkEnvelope({ id: 42 }) });
    const body = {
      projectId: 9,
      assetId: 5,
      documentType: 1 as const,
      tagIds: [1, 2],
      name: "spec.pdf",
      iconUri: "/storage/icon.svg",
    };
    const result = await registerDocument(apiClient, body);
    expect(post).toHaveBeenCalledWith("/knowledge/document", body);
    expect(result).toBe(42);
  });

  it("throws when the response fails zod validation", async () => {
    post.mockResolvedValue({ data: { totally: "wrong" } });
    await expect(
      registerDocument(apiClient, {
        projectId: 9,
        documentType: 1 as const,
        tagIds: [],
      }),
    ).rejects.toThrow();
  });
});

describe("editDocument", () => {
  it("PUTs /knowledge/document with the exact body and resolves on a data-less code:0 envelope", async () => {
    // The edit endpoint confirms success via code:0 with NO data payload
    // (unlike create, which returns a new id) — mirror deleteDocument.
    put.mockResolvedValue({ data: { code: 0, msg: "success" } });
    const body = { id: 42, name: "renamed.pdf", tagIds: [3] };
    const result = await editDocument(apiClient, body);
    expect(put).toHaveBeenCalledWith("/knowledge/document", body);
    expect(result).toBe(42);
  });

  it("rejects when the envelope carries a non-OK code", async () => {
    put.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(
      editDocument(apiClient, { id: 42, tagIds: [] }),
    ).rejects.toThrow();
  });
});

describe("deleteDocument", () => {
  it("issues DELETE /knowledge/document with { params: { id } } and resolves on a code:0 envelope", async () => {
    del.mockResolvedValue({ data: makeOkEnvelope({}) });
    await deleteDocument(apiClient, 1);
    expect(del).toHaveBeenCalledWith("/knowledge/document", {
      params: { id: 1 },
    });
  });

  it("rejects when the envelope carries a non-OK code", async () => {
    del.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(deleteDocument(apiClient, 1)).rejects.toThrow();
  });
});

describe("deletePlaybook", () => {
  it("issues DELETE /knowledge/playbook with { params: { id } } and resolves on a code:0 envelope", async () => {
    del.mockResolvedValue({ data: makeOkEnvelope({}) });
    await deletePlaybook(apiClient, 5);
    expect(del).toHaveBeenCalledWith("/knowledge/playbook", {
      params: { id: 5 },
    });
  });

  it("rejects when the envelope carries a non-OK code", async () => {
    del.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(deletePlaybook(apiClient, 5)).rejects.toThrow();
  });
});

describe("deleteDeliverable", () => {
  it("issues DELETE /project/deliverable with { params: { id } } and resolves on a code:0 envelope", async () => {
    del.mockResolvedValue({ data: makeOkEnvelope({}) });
    await deleteDeliverable(apiClient, 7);
    expect(del).toHaveBeenCalledWith("/project/deliverable", {
      params: { id: 7 },
    });
  });

  it("rejects when the envelope carries a non-OK code", async () => {
    del.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(deleteDeliverable(apiClient, 7)).rejects.toThrow();
  });
});

describe("uploadAsset", () => {
  it("POSTs FormData (project_id + file) to /project/asset and returns the UploadArtifact", async () => {
    post.mockResolvedValue({ data: makeOkEnvelope(sampleArtifact) });
    const file = new File(["data"], "doc.pdf", { type: "application/pdf" });
    const result = await uploadAsset(apiClient, 9, file);
    const [path, payload] = post.mock.calls[0] ?? [];
    expect(path).toBe("/project/asset");
    expect(payload).toBeInstanceOf(FormData);
    expect((payload as FormData).get("project_id")).toBe("9");
    expect((payload as FormData).get("file")).toBeInstanceOf(File);
    expect(result.uri).toBe("/storage/5");
  });
});
