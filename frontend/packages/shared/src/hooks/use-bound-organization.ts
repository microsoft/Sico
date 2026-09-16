import {
  useQuery,
  type UseQueryResult,
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { userAtom } from "../atoms/auth-atom";
import { selectedOrganizationIdAtom } from "../features/organization/atoms/selected-organization-atom";
import { boundOrganizationQueryOptions } from "../features/organization/hooks/use-organization-query";
import { type OrganizationSummary } from "../features/organization/schemas/organization";
import { useApiClient } from "../services/api-client-context";

export function useBoundOrganizationQuery(): UseQueryResult<OrganizationSummary | null> {
  const apiClient = useApiClient();
  const userId = useAtomValue(userAtom)?.id ?? null;
  const selectedOrganizationId = useAtomValue(selectedOrganizationIdAtom);
  return useQuery(
    boundOrganizationQueryOptions(apiClient, userId, selectedOrganizationId),
  );
}

export function useBoundOrganizationSuspenseQuery(): UseSuspenseQueryResult<OrganizationSummary | null> {
  const apiClient = useApiClient();
  const userId = useAtomValue(userAtom)?.id ?? null;
  const selectedOrganizationId = useAtomValue(selectedOrganizationIdAtom);
  const query = useSuspenseQuery(
    boundOrganizationQueryOptions(apiClient, userId, selectedOrganizationId),
  );
  if (query.isError) {
    if (!query.isFetching) {
      throw query.error;
    }
    return { ...query, data: null };
  }
  return query;
}
