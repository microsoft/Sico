import { type QueryClient } from "@tanstack/react-query";
import { type createStore } from "jotai";

import { userAtom } from "../atoms/auth-atom";
import { selectedOrganizationIdAtom } from "../features/organization/atoms/selected-organization-atom";
import { organizationKeys } from "../features/organization/query-keys";
import { type OrganizationSummary } from "../features/organization/schemas/organization";

export function selectBoundOrganization(
  organizations: OrganizationSummary[],
  selectedOrganizationId: number | null,
): OrganizationSummary | null {
  return (
    organizations.find(({ id }) => id === selectedOrganizationId) ??
    organizations[0] ??
    null
  );
}

export function getBoundOrganizationId(
  store: ReturnType<typeof createStore>,
  queryClient: QueryClient,
): number | null {
  const user = store.get(userAtom);
  if (user === null) {
    return null;
  }
  const organizations = queryClient.getQueryData<OrganizationSummary[]>(
    organizationKeys.userOrganizations(user.id),
  );
  if (organizations === undefined) {
    return null;
  }
  return (
    selectBoundOrganization(
      organizations,
      store.get(selectedOrganizationIdAtom),
    )?.id ?? null
  );
}
