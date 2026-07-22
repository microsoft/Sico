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
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useApiClient } from "../../../services/api-client-context";
import { SKILL_POLL_INTERVAL_MS, SKILL_POLL_MAX_ATTEMPTS } from "../constants";
import { type SkillStatus, SkillStatusSchema } from "../schemas/skill";
import { fetchSkillStatus } from "../services/skills";

export const SKILL_STATUS_QUERY_KEY_PREFIX = "skill-status";

function isTerminal(status: SkillStatus | undefined): boolean {
  return (
    status === SkillStatusSchema.enum.UPLOADED ||
    status === SkillStatusSchema.enum.FAILED
  );
}

// Total polling attempts so far — successful fetches plus consecutive failures.
// Counting failures too means a status endpoint that keeps erroring still hits
// the cap (otherwise dataUpdateCount, which only grows on success, would leave
// polling running forever against a broken endpoint).
export function attemptsMade(state: {
  dataUpdateCount: number;
  fetchFailureCount: number;
}): number {
  return state.dataUpdateCount + state.fetchFailureCount;
}

// The query result plus `isExhausted`: true once polling has been abandoned at
// the attempt cap while the status is still non-terminal. Callers treat that as
// a failed parse so the UI can leave its "Parsing …" state instead of hanging.
export type SkillStatusQueryResult = UseQueryResult<SkillStatus> & {
  isExhausted: boolean;
};

export function useSkillStatusQuery({
  id,
  version,
  enabled,
}: {
  id: number;
  version: string;
  enabled: boolean;
}): SkillStatusQueryResult {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const queryKey = [SKILL_STATUS_QUERY_KEY_PREFIX, id, version];
  const query = useQuery({
    queryKey,
    queryFn: () => fetchSkillStatus(apiClient, { id, version }),
    enabled,
    refetchInterval: (q) => {
      if (isTerminal(q.state.data)) {
        return false;
      }
      // Bound polling so a skill stuck in "Parsing" — or a status endpoint that
      // keeps erroring — stops hitting the backend instead of polling forever
      // (design section 6 E5).
      if (attemptsMade(q.state) >= SKILL_POLL_MAX_ATTEMPTS) {
        return false;
      }
      return SKILL_POLL_INTERVAL_MS;
    },
  });

  // Polling gave up (hit the cap) but the status never reached a terminal value
  // — the skill is stuck parsing (or the endpoint is failing). Read the counts
  // off the cached query state (the observer result doesn't expose them);
  // useQuery re-renders on every poll so this stays current. Surface it so the
  // sync hook can settle it as FAILED rather than leaving the card spinning.
  const state = queryClient.getQueryState<SkillStatus>(queryKey);
  const isExhausted =
    state !== undefined &&
    attemptsMade(state) >= SKILL_POLL_MAX_ATTEMPTS &&
    !isTerminal(query.data);

  // Spreading UseQueryResult collapses its discriminated union (isSuccess /
  // isError narrowing is lost on the returned type). Acceptable here: the only
  // consumer reads `data` + `isExhausted`, never narrows on the status flags.
  return { ...query, isExhausted } as SkillStatusQueryResult;
}
