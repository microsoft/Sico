import { QueryClient } from "@tanstack/react-query";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userOrganizationsQueryOptions } from "@/features/organization/hooks/use-organization-query";
import { organizationKeys } from "@/features/organization/query-keys";
import * as organizationService from "@/features/organization/services/organization";
import { initializeOrganizationContext } from "@/features/organization/utils/initialize-organization-context";
import { clearAuthStorage, persistLoginPayload } from "@/utils/auth-storage";
import * as storage from "@/utils/local-storage";
import { logger } from "@/utils/logger";

import {
  makeLoginPayload,
  makeOrganization,
} from "../../../helpers/organization-context";

vi.mock("@/features/organization/services/organization");

let queryClient: QueryClient;

beforeEach(() => {
  persistLoginPayload(makeLoginPayload());
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.mocked(organizationService.fetchUserOrganizations)
    .mockReset()
    .mockResolvedValue([makeOrganization()]);
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
  clearAuthStorage();
});

function blockWrites(): void {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage full", "QuotaExceededError");
  });
}

describe("optional organization cache storage failures", () => {
  it("returns validated query data when cache persistence exceeds quota", async () => {
    blockWrites();
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(
      queryClient.fetchQuery(userOrganizationsQueryOptions(axios.create(), 7)),
    ).resolves.toEqual([makeOrganization()]);

    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual([makeOrganization()]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("organization"),
      expect.objectContaining({ operation: "write" }),
    );
  });

  it("does not block cold initialization when cache persistence exceeds quota", async () => {
    blockWrites();

    await expect(
      initializeOrganizationContext(axios.create(), queryClient, 7),
    ).resolves.toBeUndefined();

    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual([makeOrganization()]);
  });

  it("falls back to the network when only the optional cache read is blocked", async () => {
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function readItem(
      this: Storage,
      key: string,
    ) {
      if (key === storage.ORGANIZATION_CONTEXT_LS) {
        throw new DOMException("Storage blocked", "SecurityError");
      }
      return getItem.call(this, key);
    });
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(
      initializeOrganizationContext(axios.create(), queryClient, 7),
    ).resolves.toBeUndefined();

    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual([makeOrganization()]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("organization"),
      expect.objectContaining({ operation: "read" }),
    );
  });

  it("returns a successful empty list even when old cache removal is blocked", async () => {
    const removeItem = storage.removeItemFromLocalStorage;
    vi.spyOn(storage, "removeItemFromLocalStorage").mockImplementation(
      (key) => {
        if (key === storage.ORGANIZATION_CONTEXT_LS) {
          throw new DOMException("Storage blocked", "SecurityError");
        }
        removeItem(key);
      },
    );
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([]);
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(
      queryClient.fetchQuery(userOrganizationsQueryOptions(axios.create(), 7)),
    ).resolves.toEqual([]);

    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("organization"),
      expect.objectContaining({ operation: "remove" }),
    );
  });
});
