// Agents fetch via TanStack Query infinite query.
//
// Two surfaces share one cache entry per
// `(operatorUsername, pageSize, projectId, showInactive)` tuple:
//   - Dashboard `/digital-worker` — uses `agentsQueryOptions` + a Route
//     `loader` prefetch + `useSuspenseAgentsInfiniteQuery` so the route
//     boundary handles loading/error.
//   - Sidebar — uses `useAgentsQuery` (non-suspense) since the sidebar
//     mounts inside an already-rendered shell and uses its own
//     skeleton/error UI.
//
// Both consumers key off the same tuple so a shared cache entry is hit once.
// The sidebar preview always uses the default `showInactive: false`, matching
// the dashboard's default filter, so they share that entry.
import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  useQuery,
  type UseQueryResult,
  useSuspenseInfiniteQuery,
  type UseSuspenseInfiniteQueryOptions,
  type UseSuspenseInfiniteQueryResult,
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { useMemo } from "react";

import { type Paged } from "../../../schemas/paginated";
import { useApiClient } from "../../../services/api-client-context";
import { DEFAULT_AGENTS_PAGE_SIZE } from "../constants";
import {
  type Agent,
  type AgentStatus,
  AgentStatusSchema,
} from "../schemas/agent";
import { fetchAgentDetail, fetchAgents } from "../services/agents";

type Params = {
  pageSize?: number;
  /** Scope to DWs a user OPERATES — the "my DWs" filter (dashboard + sidebar).
   * The backend no longer forces the current user, so callers must pass it. */
  operatorUsername?: string;
  /** Scope the list to one project (backend-filtered). Keyed separately so a
   * project's roster never shares the dashboard's "my DWs" cache entry. */
  projectId?: number;
  // When false (default), the list hides inactive DWs by asking the backend for
  // every status EXCEPT inactive — so pagination counts only visible workers
  // (no "fetched 10, showed 5"). When true, no status filter is sent (all).
  showInactive?: boolean;
};

// "Hide inactive" filter: every *concrete* `AgentStatus` except INACTIVE.
// Derived from the schema (not a literal) so a new status is included
// automatically. UNKNOWN (0) is excluded too — the backend rejects
// `status <= INSTANCE_UNKNOWN` with "Invalid status", and it's a sentinel,
// never a real worker state. Sorted for a stable request. Yields [1,2,3,5,7].
const HIDE_INACTIVE_STATUS_LIST: AgentStatus[] = Object.values(
  AgentStatusSchema.enum,
)
  .filter(
    (status) =>
      status !== AgentStatusSchema.enum.INACTIVE &&
      status !== AgentStatusSchema.enum.UNKNOWN,
  )
  .sort((a, b) => a - b);

type AgentsQueryKey = readonly [
  "agents",
  "list",
  {
    operatorUsername: string | null;
    pageSize: number;
    projectId: number | null;
    showInactive: boolean;
  },
];

type Options = UseSuspenseInfiniteQueryOptions<
  Paged<Agent>,
  Error,
  InfiniteData<Paged<Agent>>,
  AgentsQueryKey,
  number
>;

export function agentsQueryOptions(
  params: Params,
  apiClient: AxiosInstance,
): Options {
  const pageSize = params.pageSize ?? DEFAULT_AGENTS_PAGE_SIZE;
  const projectId = params.projectId ?? null;
  const operatorUsername = params.operatorUsername ?? null;
  const showInactive = params.showInactive ?? false;
  const statusList = showInactive ? undefined : HIDE_INACTIVE_STATUS_LIST;
  return {
    queryKey: [
      "agents",
      "list",
      { operatorUsername, pageSize, projectId, showInactive },
    ] as const,
    queryFn: ({ pageParam }): Promise<Paged<Agent>> =>
      fetchAgents(apiClient, {
        page: pageParam,
        pageSize,
        statusList,
        ...(operatorUsername === null ? {} : { operatorUsername }),
        ...(projectId === null ? {} : { projectId }),
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.hasNext ? lastPageParam + 1 : undefined,
    staleTime: 30_000,
    // Focus refetch drops already-loaded pages — bad UX for infinite scroll.
    refetchOnWindowFocus: false,
    gcTime: 5 * 60_000,
  };
}

/** Suspense variant — used by `/digital-worker` route. */
export function useSuspenseAgentsInfiniteQuery(
  params: Params = {},
): UseSuspenseInfiniteQueryResult<InfiniteData<Paged<Agent>>> {
  const apiClient = useApiClient();
  return useSuspenseInfiniteQuery(agentsQueryOptions(params, apiClient));
}

/** Non-suspense variant — used by sidebar (renders inline skeleton/error). */
export function useAgentsQuery(
  params: Params = {},
): UseInfiniteQueryResult<InfiniteData<Paged<Agent>>> {
  const apiClient = useApiClient();
  return useInfiniteQuery(agentsQueryOptions(params, apiClient));
}

// Prefix-key for invalidation; actual queryKey appends
// `{operatorUsername, pageSize, projectId, showInactive}`.
export const AGENTS_QUERY_KEY_PREFIX = ["agents", "list"] as const;

// Flattens pages in backend order, deduping by id — a higher `updatedAt`
// wins so a stale copy can't replace a fresher one, but the agent KEEPS
// its first-seen position (Map preserves insertion order). We intentionally
// do NOT re-sort by `updatedAt`: the backend already returns a paginated
// order, and re-sorting client-side made later pages (with larger
// `updatedAt`) jump ahead of already-rendered cards, so the grid visibly
// shuffled on "load more". Trusting the backend order keeps new pages
// appended at the end.
export function selectDedupedAgents(pages: Paged<Agent>[]): Agent[] {
  const byId = new Map<Agent["id"], Agent>();
  for (const page of pages) {
    for (const agent of page.items) {
      const existing = byId.get(agent.id);
      if (
        !existing ||
        (agent.updatedAt ?? -Infinity) >= (existing.updatedAt ?? -Infinity)
      ) {
        byId.set(agent.id, agent);
      }
    }
  }
  return Array.from(byId.values());
}

// Memoised wrapper so consumers don't re-flatten/re-sort on every
// parent render. Keyed on `pages` identity — react-query returns a
// stable reference when nothing has changed.
export function useDedupedAgents(pages: Paged<Agent>[] | undefined): Agent[] {
  return useMemo(() => selectDedupedAgents(pages ?? []), [pages]);
}

type AgentDetailQueryKey = readonly ["agents", "detail", number];

// Header agent metadata. Singular detail query, distinct key from the list.
export function agentQueryOptions(
  agentId: number,
  apiClient: AxiosInstance,
): UseSuspenseQueryOptions<Agent, Error, Agent, AgentDetailQueryKey> {
  return {
    queryKey: ["agents", "detail", agentId] as const,
    queryFn: (): Promise<Agent> => fetchAgentDetail(apiClient, agentId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  };
}

/** Suspense variant — used where a route boundary owns loading/error. */
export function useAgentSuspenseQuery(
  agentId: number,
): UseSuspenseQueryResult<Agent> {
  const apiClient = useApiClient();
  return useSuspenseQuery(agentQueryOptions(agentId, apiClient));
}

/** Non-suspense variant — used where the component renders its own
 * pending/absent affordance (chat pills/buttons that must never suspend). */
export function useAgentQuery(agentId: number): UseQueryResult<Agent> {
  const apiClient = useApiClient();
  return useQuery(agentQueryOptions(agentId, apiClient));
}
