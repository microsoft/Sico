import type { QueryClient } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { readOrganizationContextCache } from "./organization-context-cache";
import { userOrganizationsQueryOptions } from "../hooks/use-organization-query";
import { organizationKeys } from "../query-keys";
import type { OrganizationSummary } from "../schemas/organization";

export async function initializeOrganizationContext(
  apiClient: AxiosInstance,
  queryClient: QueryClient,
  userId: number,
): Promise<void> {
  const queryKey = organizationKeys.userOrganizations(userId);
  if (queryClient.getQueryData<OrganizationSummary[]>(queryKey) !== undefined) {
    return;
  }
  const cached = readOrganizationContextCache(userId);
  if (cached !== null) {
    queryClient.setQueryData(queryKey, cached);
    return;
  }
  await queryClient.fetchQuery(
    userOrganizationsQueryOptions(apiClient, userId),
  );
}
