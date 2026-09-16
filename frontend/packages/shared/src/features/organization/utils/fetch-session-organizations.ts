import type { AxiosInstance } from "axios";

import { persistOrganizationContextCache } from "./organization-context-cache";
import { getAccessToken, loadFromLS } from "../../../utils/auth-storage";
import type { OrganizationSummary } from "../schemas/organization";
import { organizationContextOrganizationsSchema } from "../schemas/organization-context-cache";
import { fetchUserOrganizations } from "../services/organization";

function assertOrganizationSession(userId: number, token: string | null): void {
  if (
    token === null ||
    getAccessToken() !== token ||
    loadFromLS()?.id !== userId
  ) {
    throw new Error("Organization session changed");
  }
}

export async function fetchSessionOrganizations(
  apiClient: AxiosInstance,
  userId: number,
): Promise<OrganizationSummary[]> {
  const token = getAccessToken();
  assertOrganizationSession(userId, token);
  let organizations: OrganizationSummary[];
  try {
    organizations = await fetchUserOrganizations(apiClient);
  } finally {
    // Reject both stale successes and failures before React Query can commit.
    assertOrganizationSession(userId, token);
  }
  const validated = organizationContextOrganizationsSchema.parse(organizations);
  persistOrganizationContextCache(userId, validated);
  return validated;
}
