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
  createKnowledgeTag,
  deleteKnowledgeTag,
  editKnowledgeTag,
  fetchKnowledgeTags,
} from "@/features/projects/services/knowledge-tags";
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

const sampleKnowledgeTag = {
  id: 1,
  projectId: 9,
  name: "Refunds",
  description: "Use this when a customer asks for a refund.",
  creatorUsername: "alice",
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_001,
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

describe("fetchKnowledgeTags", () => {
  it("issues GET /knowledge/tags with params and returns Paged<KnowledgeTag>", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({ tags: [sampleKnowledgeTag], total: 1 }),
    });
    const result = await fetchKnowledgeTags(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 100,
    });
    expect(get).toHaveBeenCalledWith("/knowledge/tags", {
      params: { projectId: 9, page: 1, pageSize: 100 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("derives hasNext: true when the page is completely full (cap hit)", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      ...sampleKnowledgeTag,
      id: i + 1,
    }));
    get.mockResolvedValue({
      data: makeOkEnvelope({ tags: fullPage, total: 250 }),
    });
    const result = await fetchKnowledgeTags(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 100,
    });
    expect(result.hasNext).toBe(true);
  });

  it("derives hasNext: false for a short (non-full) page", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({ tags: [sampleKnowledgeTag], total: 1 }),
    });
    const result = await fetchKnowledgeTags(apiClient, {
      projectId: 9,
      page: 1,
      pageSize: 100,
    });
    expect(result.hasNext).toBe(false);
  });

  it("throws when the list response fails zod validation", async () => {
    get.mockResolvedValue({ data: { totally: "wrong" } });
    await expect(
      fetchKnowledgeTags(apiClient, { projectId: 9, page: 1, pageSize: 100 }),
    ).rejects.toThrow();
  });
});

describe("createKnowledgeTag", () => {
  it("POSTs /knowledge/tag with description carrying the when-to-use copy and returns the id", async () => {
    post.mockResolvedValue({ data: makeOkEnvelope({ id: 7 }) });
    const body = {
      projectId: 9,
      name: "Refunds",
      description: "Use this when a customer asks for a refund.",
    };
    const result = await createKnowledgeTag(apiClient, body);
    expect(post).toHaveBeenCalledWith("/knowledge/tag", body);
    expect(result).toBe(7);
  });
});

describe("editKnowledgeTag", () => {
  it("PUTs /knowledge/tag and echoes the id from a data-less success envelope", async () => {
    // The real PUT succeeds with a bare `{ code: 0, msg: "success" }` — no
    // `data.id` (unlike create's POST). The service must not require it.
    put.mockResolvedValue({ data: { code: 0, msg: "success" } });
    const body = {
      id: 7,
      name: "Refunds v2",
      description: "Updated when-to-use copy.",
    };
    const result = await editKnowledgeTag(apiClient, body);
    expect(put).toHaveBeenCalledWith("/knowledge/tag", body);
    expect(result).toBe(7);
  });

  it("rejects when the envelope carries a non-OK code", async () => {
    put.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(
      editKnowledgeTag(apiClient, { id: 7, name: "x", description: "" }),
    ).rejects.toThrow();
  });
});

describe("deleteKnowledgeTag", () => {
  it("issues DELETE /knowledge/tag with { params: { id } }", async () => {
    del.mockResolvedValue({ data: makeOkEnvelope({ id: 1 }) });
    await deleteKnowledgeTag(apiClient, 1);
    expect(del).toHaveBeenCalledWith("/knowledge/tag", {
      params: { id: 1 },
    });
  });

  it("rejects when the envelope carries a non-OK code", async () => {
    del.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(deleteKnowledgeTag(apiClient, 1)).rejects.toThrow();
  });
});
