import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import {
  fetchFirstOrganization,
  fetchOrganization,
  fetchUserOrganizations,
  updateOrganization,
} from "../../../../src/features/organization/services/organization";
import { makeOkEnvelope } from "../../../../src/schemas/api";

function makeClient(): {
  client: AxiosInstance;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn();
  const put = vi.fn();
  const client = { get, put } as Partial<AxiosInstance> as AxiosInstance;
  return { client, get, put };
}

const organization = {
  id: 9,
  name: "SICO",
  description: "Symbiotic intelligence",
  createdAt: 1_754_000_000,
  updatedAt: 1_754_000_100,
  creatorUsername: "creator@example.com",
  roleCodes: ["org_admin", "org_member"],
  isOwner: false,
};

const organizationDetail = {
  id: organization.id,
  name: organization.name,
  description: organization.description,
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt,
};

describe("fetchFirstOrganization", () => {
  it("requests the first organization and returns it", async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({
      data: makeOkEnvelope({
        organizations: [organization],
        total: 3,
        hasNext: true,
      }),
    });

    await expect(fetchFirstOrganization(client)).resolves.toEqual(organization);
    expect(get).toHaveBeenCalledWith("/organization/user_organizations", {
      params: { page: 1, pageSize: 10 },
    });
  });

  it("returns null when the backend sends a null organization list", async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({
      data: makeOkEnvelope({ organizations: null, total: 0, hasNext: false }),
    });

    await expect(fetchFirstOrganization(client)).resolves.toBeNull();
  });

  it("returns null when no organization exists", async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({
      data: makeOkEnvelope({ organizations: [], total: 0, hasNext: false }),
    });

    await expect(fetchFirstOrganization(client)).resolves.toBeNull();
  });

  it("rejects a non-OK business envelope", async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({ data: { code: 100003, msg: "forbidden" } });

    await expect(fetchFirstOrganization(client)).rejects.toThrow(
      /rejected \(code 100003\)/,
    );
  });

  it("rejects a malformed organization payload", async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({
      data: makeOkEnvelope({
        organizations: [{ ...organization, id: "9" }],
        total: 1,
        hasNext: false,
      }),
    });

    await expect(fetchFirstOrganization(client)).rejects.toThrow();
  });
});

describe("fetchUserOrganizations", () => {
  it("returns only the first page even when more organizations exist", async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({
      data: makeOkEnvelope({
        organizations: [organization],
        total: 11,
        hasNext: true,
      }),
    });

    await expect(fetchUserOrganizations(client)).resolves.toEqual([
      organization,
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/organization/user_organizations", {
      params: { page: 1, pageSize: 10 },
    });
  });
});

describe("fetchOrganization", () => {
  it("requests organization detail by id", async () => {
    const { client, get } = makeClient();
    get.mockResolvedValue({
      data: makeOkEnvelope({ organization: organizationDetail }),
    });

    await expect(fetchOrganization(client, 9)).resolves.toEqual(
      organizationDetail,
    );
    expect(get).toHaveBeenCalledWith("/organization", { params: { id: 9 } });
  });
});

describe("updateOrganization", () => {
  it("updates the organization name", async () => {
    const { client, put } = makeClient();
    put.mockResolvedValue({ data: makeOkEnvelope({}) });

    await expect(
      updateOrganization(client, 9, { name: "New name" }),
    ).resolves.toBeUndefined();
    expect(put).toHaveBeenCalledWith("/organization", {
      id: 9,
      name: "New name",
    });
  });

  it("sends a supplied organization icon URI", async () => {
    const { client, put } = makeClient();
    put.mockResolvedValue({ data: makeOkEnvelope({}) });

    await updateOrganization(client, 9, {
      name: "New name",
      iconUri: "organization/9/avatar.png",
    });

    expect(put).toHaveBeenCalledWith("/organization", {
      id: 9,
      name: "New name",
      iconUri: "organization/9/avatar.png",
    });
  });

  it("rejects a non-OK business envelope", async () => {
    const { client, put } = makeClient();
    put.mockResolvedValue({ data: { code: 100003, msg: "forbidden" } });

    await expect(
      updateOrganization(client, 9, { name: "New name" }),
    ).rejects.toThrow(/rejected \(code 100003\)/);
  });
});
