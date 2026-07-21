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
