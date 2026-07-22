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

import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchDeliverableDetail,
  fetchDeliverables,
  fetchDocumentDetails,
  fetchDocuments,
  fetchKnowledgeDocument,
  fetchKnowledgeItems,
  fetchPlaybook,
  fetchPlaybookDetails,
  fetchPlaybooks,
} from "@/features/projects/services/assets";
import { makeOkEnvelope } from "@/schemas/api";

function makeClient(
  get: ReturnType<typeof vi.fn>,
  post: ReturnType<typeof vi.fn>,
  put: ReturnType<typeof vi.fn>,
  del: ReturnType<typeof vi.fn>,
): AxiosInstance {
  return {
    get,
    post,
    put,
    delete: del,
  } as Partial<AxiosInstance> as AxiosInstance;
}

const sampleDocument = {
  id: 1,
  name: "spec.pdf",
  documentType: 1,
  status: 2,
  tags: [],
  creatorUsername: "alice",
  createdAt: 1_700_000_000,
};

const samplePlaybook = {
  id: 1,
  name: "Refund flow",
  projectId: 9,
  agentInstanceId: 4,
  tags: [],
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_001,
};

const sampleDocumentDetails = { summary: "s", fullText: "ft" };
const samplePlaybookDetails = { content: "c", name: "Refund flow" };

// Unified-list wire items (`GET /knowledge/items`) — discriminated by int `type`.
const documentItem = { type: 1, document: sampleDocument, updatedAt: 1 };
const playbookItem = {
  type: 2,
  playbook: {
    ...samplePlaybook,
    extraInfo: { agentInstance: { agentName: "Max", agentIconUrl: "/i.svg" } },
  },
  updatedAt: 1,
};
const deliverableItem = {
  type: 3,
  deliverable: {
    id: 7,
    projectId: 9,
    fileName: "report.md",
    fileSasUrl: "https://sas/report.md",
    agentInstanceId: 4,
    createdAt: 1_700_000_000,
    extraInfo: { agentInstance: { agentName: "Max", agentIconUrl: "/i.svg" } },
  },
  updatedAt: 1,
};

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const apiClient = makeClient(get, post, put, del);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  del.mockReset();
});

describe("fetchKnowledgeItems", () => {
  it("issues GET /knowledge/items with params and maps the mixed wire items to client AssetRows", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        items: [documentItem, playbookItem, deliverableItem],
        total: 3,
        hasNext: false,
      }),
    });
    const result = await fetchKnowledgeItems(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 100,
    });
    expect(get).toHaveBeenCalledWith("/knowledge/items", {
      params: { projectId: 9, page: 1, pageSize: 100 },
    });
    // The mixed wire items (int `type` 1/2/3) are mapped to the client row
    // union (string `type`) by the envelope transform.
    expect(result.items.map((row) => row.type)).toEqual([
      "knowledge",
      "experience",
      "deliverable",
    ]);
    expect(result.total).toBe(3);
  });

  it("reads hasNext off the wire (authoritative, no client derivation)", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        items: [documentItem],
        total: 250,
        hasNext: true,
      }),
    });
    const result = await fetchKnowledgeItems(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 100,
    });
    expect(result.hasNext).toBe(true);
  });

  it("defaults hasNext to false when the wire omits it", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({ items: [documentItem], total: 1 }),
    });
    const result = await fetchKnowledgeItems(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 100,
    });
    expect(result.hasNext).toBe(false);
  });

  it("throws when the list response fails zod validation", async () => {
    get.mockResolvedValue({ data: { totally: "wrong" } });
    await expect(
      fetchKnowledgeItems(apiClient, { projectId: 9, page: 1, pageSize: 100 }),
    ).rejects.toThrow();
  });

  it("rejects a non-OK code with the real code, not a 'missing data' error", async () => {
    // An error envelope (non-zero code, no data) must surface the rejection
    // code via unwrapData — not the misleading "missing data" message.
    get.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(
      fetchKnowledgeItems(apiClient, { projectId: 9, page: 1, pageSize: 100 }),
    ).rejects.toThrow(/rejected \(code 101008\)/);
  });
});

describe("fetchDocuments", () => {
  it("issues GET /knowledge/documents and renames documents→items", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        documents: [sampleDocument],
        total: 1,
        hasNext: false,
      }),
    });
    const result = await fetchDocuments(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 30,
    });
    expect(get).toHaveBeenCalledWith("/knowledge/documents", {
      params: { projectId: 9, page: 1, pageSize: 30 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.hasNext).toBe(false);
  });

  it("defaults hasNext to false when the wire omits it", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({ documents: [sampleDocument], total: 1 }),
    });
    const result = await fetchDocuments(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 30,
    });
    expect(result.hasNext).toBe(false);
  });
});

describe("fetchPlaybooks", () => {
  it("issues GET /knowledge/playbooks and renames playbooks→items", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        playbooks: [{ ...samplePlaybook, extraInfo: null }],
        total: 1,
        hasNext: true,
      }),
    });
    const result = await fetchPlaybooks(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 30,
    });
    expect(get).toHaveBeenCalledWith("/knowledge/playbooks", {
      params: { projectId: 9, page: 1, pageSize: 30 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.hasNext).toBe(true);
  });

  it("tolerates extraInfo:null on a playbook row and folds it into an agent creator", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        playbooks: [{ ...samplePlaybook, extraInfo: null }],
        total: 1,
        hasNext: false,
      }),
    });
    const result = await fetchPlaybooks(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 30,
    });
    // extraInfo:null degrades to an agent creator with no name (the client row
    // never carries the raw `extraInfo` wire block).
    const row = result.items[0];
    expect(row?.type).toBe("experience");
    expect(row?.creator).toEqual({
      kind: "agent",
      agentInstanceId: 4,
      agentName: undefined,
      iconUrl: undefined,
    });
    expect(row).not.toHaveProperty("extraInfo");
  });
});

describe("fetchDeliverables", () => {
  it("issues GET /project/deliverables, renames deliverables→items, hasMore→hasNext", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        deliverables: [deliverableItem.deliverable],
        total: 1,
        // The deliverables endpoint sends `hasMore` (NOT `hasNext`).
        hasMore: true,
      }),
    });
    const result = await fetchDeliverables(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 30,
    });
    expect(get).toHaveBeenCalledWith("/project/deliverables", {
      params: { projectId: 9, page: 1, pageSize: 30 },
    });
    expect(result.items).toHaveLength(1);
    // The wire `fileName` is renamed to the client row's `name`.
    expect(result.items[0]?.name).toBe("report.md");
    // `hasMore:true` on the wire surfaces as the canonical `hasNext:true`.
    expect(result.hasNext).toBe(true);
  });

  it("defaults hasNext to false when hasMore is absent", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        deliverables: [deliverableItem.deliverable],
        total: 1,
      }),
    });
    const result = await fetchDeliverables(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 30,
    });
    expect(result.hasNext).toBe(false);
  });
});

describe("fetchDeliverableDetail", () => {
  it("issues GET /project/deliverable with { params: { id } } and returns the deliverable", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({ deliverable: deliverableItem.deliverable }),
    });
    const result = await fetchDeliverableDetail(apiClient, 7);
    expect(get).toHaveBeenCalledWith("/project/deliverable", {
      params: { id: 7 },
    });
    // Returns the raw wire deliverable — the detail page reads fileSasUrl +
    // fileName straight off it (no client-row rename here).
    expect(result.fileName).toBe("report.md");
    expect(result.fileSasUrl).toBe("https://sas/report.md");
    expect(result.id).toBe(7);
  });

  it("throws when the envelope is missing the deliverable key", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope({}) });
    await expect(fetchDeliverableDetail(apiClient, 7)).rejects.toThrow();
  });
});

describe("fetchKnowledgeDocument", () => {
  it("issues GET /knowledge/document with { params: { id } } and returns the doc", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({ document: sampleDocument }),
    });
    const result = await fetchKnowledgeDocument(apiClient, 1);
    expect(get).toHaveBeenCalledWith("/knowledge/document", {
      params: { id: 1 },
    });
    expect(result.name).toBe("spec.pdf");
    expect(result.id).toBe(1);
  });

  it("throws when the envelope is missing the document key", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope({}) });
    await expect(fetchKnowledgeDocument(apiClient, 1)).rejects.toThrow();
  });
});

describe("fetchDocumentDetails", () => {
  it("issues GET /knowledge/document/details with { params: { id } } and returns details", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope(sampleDocumentDetails) });
    const result = await fetchDocumentDetails(apiClient, 1);
    expect(get).toHaveBeenCalledWith("/knowledge/document/details", {
      params: { id: 1 },
    });
    expect(result.fullText).toBe("ft");
  });
});

describe("fetchPlaybookDetails", () => {
  it("issues GET /knowledge/playbook/details with { params: { id } } and returns details", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope(samplePlaybookDetails) });
    const result = await fetchPlaybookDetails(apiClient, 1);
    expect(get).toHaveBeenCalledWith("/knowledge/playbook/details", {
      params: { id: 1 },
    });
    expect(result.content).toBe("c");
  });
});

describe("fetchPlaybook", () => {
  it("issues GET /knowledge/playbook with { params: { id } } and returns the playbook (incl. projectId)", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({ playbook: samplePlaybook }),
    });
    const result = await fetchPlaybook(apiClient, 1);
    expect(get).toHaveBeenCalledWith("/knowledge/playbook", {
      params: { id: 1 },
    });
    // The single-playbook endpoint is the ONLY source of projectId for the
    // top-level playbook detail page (the /details body omits it).
    expect(result.projectId).toBe(9);
  });

  it("throws when the envelope is missing the playbook key", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope({}) });
    await expect(fetchPlaybook(apiClient, 1)).rejects.toThrow();
  });
});
