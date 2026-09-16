import { QueryClient } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deviceKeys } from "@/features/devices";
import { organizationDevicesQueryOptions } from "@/features/devices/hooks/use-organization-devices-query";
import * as devicesService from "@/features/devices/services/devices";
import {
  organizationProjectsQueryOptions,
  selectDedupedOrganizationProjects,
} from "@/features/organization/hooks/use-organization-projects-query";
import {
  boundOrganizationQueryOptions,
  organizationDetailQueryOptions,
} from "@/features/organization/hooks/use-organization-query";
import { organizationKeys } from "@/features/organization/query-keys";
import * as organizationService from "@/features/organization/services/organization";
import { type OrganizationProject } from "@/features/projects/schemas/project";
import * as projectsService from "@/features/projects/services/projects";
import { persistLoginPayload } from "@/utils/auth-storage";

import { makeLoginPayload } from "../../../helpers/organization-context";

vi.mock("@/features/organization/services/organization");
vi.mock("@/features/projects/services/projects");
vi.mock("@/features/devices/services/devices");

beforeEach(() => {
  vi.mocked(organizationService.fetchUserOrganizations)
    .mockReset()
    .mockResolvedValue([]);
  vi.mocked(organizationService.fetchOrganization)
    .mockReset()
    .mockResolvedValue({
      id: 9,
      name: "SICO",
      description: "",
      createdAt: 1,
      updatedAt: 1,
    });
  vi.mocked(projectsService.fetchOrganizationProjects)
    .mockReset()
    .mockResolvedValue({ items: [], total: 0, hasNext: false });
  vi.mocked(devicesService.fetchDevices).mockReset().mockResolvedValue([]);
});

function project(
  id: number,
  name: string,
  updatedAt: number,
): OrganizationProject {
  return {
    id,
    name,
    description: "",
    iconUrl: "",
    agentInstances: [],
    memberType: 0,
    ownerUsername: "owner@example.com",
    creatorUsername: "owner@example.com",
    organizationId: 9,
    createdAt: 1,
    updatedAt,
  };
}

describe("organization resource queries", () => {
  it("selects the first organization under the user-scoped list key", async () => {
    persistLoginPayload(makeLoginPayload());
    const apiClient = {} as AxiosInstance;
    const options = boundOrganizationQueryOptions(apiClient, 7);

    expect(options.queryKey).toEqual(organizationKeys.userOrganizations(7));
    await new QueryClient().fetchQuery(options);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledWith(
      apiClient,
    );
    expect(options.select?.([])).toBeNull();
  });

  it("fetches organization detail under its ID", async () => {
    const apiClient = {} as AxiosInstance;
    const options = organizationDetailQueryOptions(9, apiClient);

    expect(options.queryKey).toEqual(organizationKeys.detail(9));
    await new QueryClient().fetchQuery(options);
    expect(organizationService.fetchOrganization).toHaveBeenCalledWith(
      apiClient,
      9,
    );
  });

  it("fetches projects as an infinite query under the organization prefix", async () => {
    const apiClient = {} as AxiosInstance;
    const options = organizationProjectsQueryOptions(9, apiClient);

    expect(options.queryKey).toEqual([
      ...organizationKeys.projects(9),
      { pageSize: 50 },
    ]);
    await new QueryClient().fetchInfiniteQuery(options);
    expect(projectsService.fetchOrganizationProjects).toHaveBeenCalledWith(
      apiClient,
      9,
      { page: 1, pageSize: 50 },
    );
  });

  it("stops project pagination after an empty page", () => {
    const options = organizationProjectsQueryOptions(9, {} as AxiosInstance);
    const emptyPage = { items: [], total: 5, hasNext: true };
    expect(
      options.getNextPageParam(emptyPage, [emptyPage], 1, [1]),
    ).toBeUndefined();
  });

  it("deduplicates project pages without changing first-seen order", () => {
    const atlas = project(1, "Atlas", 1);
    const beacon = project(2, "Beacon", 1);
    const fresherAtlas = project(1, "Atlas 2", 2);

    expect(
      selectDedupedOrganizationProjects([
        { items: [atlas, beacon], total: 2, hasNext: true },
        { items: [fresherAtlas], total: 2, hasNext: false },
      ]),
    ).toEqual([fresherAtlas, beacon]);
  });

  it("fetches devices under the organization device key", async () => {
    const apiClient = {} as AxiosInstance;
    const options = organizationDevicesQueryOptions(9, apiClient);

    expect(options.queryKey).toEqual(deviceKeys.organization(9));
    await new QueryClient().fetchQuery(options);
    expect(devicesService.fetchDevices).toHaveBeenCalledWith(apiClient, {
      organizationId: 9,
    });
  });
});
