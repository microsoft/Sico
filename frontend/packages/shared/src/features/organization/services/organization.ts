import type { AxiosInstance } from "axios";
import { z } from "zod";

import { ORGANIZATION_ENDPOINTS } from "../../../constants/endpoints";
import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";
import { type Paged } from "../../../schemas/paginated";
import {
  type OrganizationDetail,
  organizationDetailSchema,
  type OrganizationSummary,
  organizationSummarySchema,
} from "../schemas/organization";

const organizationListEnvelope = apiResponseSchema(
  z
    .object({
      organizations: z
        .array(organizationSummarySchema)
        .nullish()
        .transform((organizations) => organizations ?? []),
      total: z.number().int().nonnegative(),
      hasNext: z.boolean(),
    })
    .transform(
      ({ organizations, ...rest }): Paged<OrganizationSummary> => ({
        items: organizations,
        total: rest.total,
        hasNext: rest.hasNext,
      }),
    ),
);

const organizationDetailEnvelope = apiResponseSchema(
  z.object({ organization: organizationDetailSchema }),
);

const USER_ORGANIZATIONS_PAGE_SIZE = 10;

export async function fetchUserOrganizationsPage(
  apiClient: AxiosInstance,
  page: number,
): Promise<Paged<OrganizationSummary>> {
  const response = await apiClient.get<unknown>(ORGANIZATION_ENDPOINTS.list, {
    params: { page, pageSize: USER_ORGANIZATIONS_PAGE_SIZE },
  });
  return unwrapData(
    organizationListEnvelope.parse(response.data),
    "fetchUserOrganizationsPage",
  );
}

export async function fetchFirstOrganization(
  apiClient: AxiosInstance,
): Promise<OrganizationSummary | null> {
  const page = await fetchUserOrganizationsPage(apiClient, 1);
  return page.items[0] ?? null;
}

export async function fetchUserOrganizations(
  apiClient: AxiosInstance,
): Promise<OrganizationSummary[]> {
  const page = await fetchUserOrganizationsPage(apiClient, 1);
  return page.items;
}

export async function fetchOrganization(
  apiClient: AxiosInstance,
  id: number,
): Promise<OrganizationDetail> {
  const response = await apiClient.get<unknown>(ORGANIZATION_ENDPOINTS.root, {
    params: { id },
  });
  return unwrapData(
    organizationDetailEnvelope.parse(response.data),
    "fetchOrganization",
  ).organization;
}

export type OrganizationUpdate = { name: string; iconUri?: string };

export async function updateOrganization(
  apiClient: AxiosInstance,
  id: number,
  values: OrganizationUpdate,
): Promise<void> {
  const response = await apiClient.put<unknown>(ORGANIZATION_ENDPOINTS.root, {
    id,
    name: values.name,
    ...(values.iconUri ? { iconUri: values.iconUri } : {}),
  });
  assertOk(
    apiResponseSchema(z.unknown()).parse(response.data),
    "updateOrganization",
  );
}
