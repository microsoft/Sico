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
