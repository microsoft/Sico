import { organizationKeys } from "@sico/shared/features/organization/query-keys.ts";
import type { OrganizationSummary } from "@sico/shared/features/organization/schemas/organization.ts";
import type { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

export function makeOrganization(id = 9): OrganizationSummary {
  return {
    id,
    name: `Organization ${id}`,
    description: "",
    createdAt: 1,
    updatedAt: 1,
    creatorUsername: "owner@example.test",
    roleCodes: [],
    isOwner: false,
  };
}

// Opt in only for suites whose subject is not organization initialization.
export function seedOrganizationContext(
  queryClient: QueryClient,
  userId = 1,
): void {
  queryClient.setQueryData(organizationKeys.userOrganizations(userId), [
    makeOrganization(),
  ]);
}

export function organizationMembershipHandler(): ReturnType<typeof http.get> {
  return http.get("/api/sico/organization/user_organizations", () =>
    HttpResponse.json({
      code: 0,
      msg: "ok",
      data: { organizations: [makeOrganization()], total: 1, hasNext: false },
    }),
  );
}
