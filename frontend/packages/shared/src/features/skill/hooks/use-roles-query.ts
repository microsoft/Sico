import {
  useQuery,
  type UseQueryResult,
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type Role } from "../schemas/roles";
import { fetchRoles } from "../services/roles";

export const ROLES_QUERY_KEY_PREFIX = "agent-roles";

type RolesQueryKey = readonly ["agent-roles"];

export function rolesQueryOptions(
  apiClient: AxiosInstance,
): UseSuspenseQueryOptions<Role[], Error, Role[], RolesQueryKey> {
  return {
    queryKey: [ROLES_QUERY_KEY_PREFIX] as const,
    queryFn: (): Promise<Role[]> => fetchRoles(apiClient),
    // Roles are effectively static per session; a 30s stale window lets the
    // route loader's prefetch satisfy the component mount without a duplicate
    // refetch (default staleTime of 0 would refetch immediately on subscribe).
    staleTime: 30_000,
  };
}

export function useRolesQuery(): UseQueryResult<Role[]> {
  const apiClient = useApiClient();
  return useQuery(rolesQueryOptions(apiClient));
}

export function useRolesSuspenseQuery(): UseSuspenseQueryResult<Role[]> {
  const apiClient = useApiClient();
  return useSuspenseQuery(rolesQueryOptions(apiClient));
}
