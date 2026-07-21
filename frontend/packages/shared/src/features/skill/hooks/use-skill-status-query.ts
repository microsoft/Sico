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
