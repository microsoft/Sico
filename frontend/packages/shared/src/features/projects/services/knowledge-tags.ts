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
import { z } from "zod";

import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";
import { type Paged } from "../../../schemas/paginated";
import {
  type KnowledgeTag,
  knowledgeTagSchema,
} from "../schemas/knowledge-tag";

// WIRE-SHAPE: entity-plural key + total, no hasNext on the wire — derived after
// parsing as `items.length === pageSize` (cap hit), like assets (M-1).
const knowledgeTagsListEnvelope = apiResponseSchema(
  z.object({
    tags: z.array(knowledgeTagSchema),
    total: z.number().int().nonnegative(),
  }),
);

const idEnvelope = apiResponseSchema(z.object({ id: z.number().int() }));

type KnowledgeTagsParams = {
  projectId: number;
  page: number;
  pageSize: number;
};

export async function fetchKnowledgeTags(
  apiClient: AxiosInstance,
  { projectId, page, pageSize }: KnowledgeTagsParams,
): Promise<Paged<KnowledgeTag>> {
  const response = await apiClient.get<unknown>("/knowledge/tags", {
    params: { projectId, page, pageSize },
  });
  const parsed = knowledgeTagsListEnvelope.parse(response.data);
  const { tags, total } = unwrapData(parsed, "fetchKnowledgeTags");
  return { items: tags, total, hasNext: tags.length === pageSize };
}

// The dialog's "When to use" field maps to `description` — there is no
// `whenToUse`.
type CreateKnowledgeTagBody = {
  projectId: number;
  name: string;
  description: string;
};

export async function createKnowledgeTag(
  apiClient: AxiosInstance,
  body: CreateKnowledgeTagBody,
): Promise<number> {
  const response = await apiClient.post<unknown>("/knowledge/tag", body);
  const parsed = idEnvelope.parse(response.data);
  return unwrapData(parsed, "createKnowledgeTag").id;
}

type EditKnowledgeTagBody = {
  id: number;
  name: string;
  description: string;
};

// PUT succeeds with a bare `{ code, msg }` envelope — no `data.id` (unlike POST),
// so validate the code and echo back the id we sent.
export async function editKnowledgeTag(
  apiClient: AxiosInstance,
  body: EditKnowledgeTagBody,
): Promise<number> {
  const response = await apiClient.put<unknown>("/knowledge/tag", body);
  const parsed = apiResponseSchema(z.unknown()).parse(response.data);
  assertOk(parsed, "editKnowledgeTag");
  return body.id;
}

export async function deleteKnowledgeTag(
  apiClient: AxiosInstance,
  id: number,
): Promise<void> {
  const response = await apiClient.delete<unknown>("/knowledge/tag", {
    params: { id },
  });
  const parsed = apiResponseSchema(z.unknown()).parse(response.data);
  assertOk(parsed, "deleteKnowledgeTag");
}
