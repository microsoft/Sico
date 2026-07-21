import {
  useQuery,
  type UseQueryResult,
  type UseSuspenseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type SkillDetail } from "../schemas/skill";
import { fetchSkillDetail } from "../services/skills";

export const SKILL_DETAIL_QUERY_KEY_PREFIX = "skill-detail";

type SkillDetailQueryKey = readonly ["skill-detail", number];

export function skillDetailQueryOptions(
  apiClient: AxiosInstance,
  id: number,
): UseSuspenseQueryOptions<
  SkillDetail,
  Error,
  SkillDetail,
  SkillDetailQueryKey
> {
  return {
    queryKey: [SKILL_DETAIL_QUERY_KEY_PREFIX, id] as const,
    queryFn: (): Promise<SkillDetail> => fetchSkillDetail(apiClient, id),
  };
}

export function useSkillDetailQuery(
  id: number,
  options?: { enabled?: boolean },
): UseQueryResult<SkillDetail> {
  const apiClient = useApiClient();
  return useQuery({
    ...skillDetailQueryOptions(apiClient, id),
    enabled: options?.enabled ?? true,
  });
}
