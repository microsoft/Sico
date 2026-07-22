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

import {
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { type Paged } from "../../../schemas/paginated";
import { useApiClient } from "../../../services/api-client-context";
import type { KnowledgeTag } from "../schemas/knowledge-tag";
import { fetchKnowledgeTags } from "../services/knowledge-tags";

// Knowledge tags have no infinite scroll this release — one capped page.
const KNOWLEDGE_TAGS_PAGE = 1;
const KNOWLEDGE_TAGS_PAGE_SIZE = 100;

export function knowledgeTagsQueryOptions(
  projectId: number,
  apiClient: AxiosInstance,
): {
  queryKey: readonly ["projects", "knowledge-tags", number];
  queryFn: () => Promise<Paged<KnowledgeTag>>;
  staleTime: number;
} {
  return {
    queryKey: ["projects", "knowledge-tags", projectId] as const,
    queryFn: (): Promise<Paged<KnowledgeTag>> =>
      fetchKnowledgeTags(apiClient, {
        projectId,
        page: KNOWLEDGE_TAGS_PAGE,
        pageSize: KNOWLEDGE_TAGS_PAGE_SIZE,
      }),
    staleTime: 30_000,
  };
}

export function useKnowledgeTagsQuery(
  projectId: number,
): UseSuspenseQueryResult<Paged<KnowledgeTag>> {
  const apiClient = useApiClient();
  return useSuspenseQuery(knowledgeTagsQueryOptions(projectId, apiClient));
}
