import { QueryClient } from "@tanstack/react-query";
import axios from "axios";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loginAtom, logoutAtom } from "@/atoms/auth-atom";
import { userOrganizationsQueryOptions } from "@/features/organization/hooks/use-organization-query";
import { organizationKeys } from "@/features/organization/query-keys";
import type { OrganizationSummary } from "@/features/organization/schemas/organization";
import * as organizationService from "@/features/organization/services/organization";
import { clearAuthStorage } from "@/utils/auth-storage";
import {
  getItemFromLocalStorage,
  ORGANIZATION_CONTEXT_LS,
  setItemToLocalStorage,
} from "@/utils/local-storage";

import {
  deferOrganizations,
  makeLoginPayload,
  makeOrganization,
} from "../../../helpers/organization-context";

vi.mock("@/features/organization/services/organization");

let store: ReturnType<typeof createStore>;
let queryClient: QueryClient;

beforeEach(() => {
  clearAuthStorage();
  store = createStore();
  store.set(loginAtom, makeLoginPayload());
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.mocked(organizationService.fetchUserOrganizations).mockReset();
});

afterEach(() => {
  queryClient.clear();
  clearAuthStorage();
});

function queryOrganizations(userId = 7): Promise<OrganizationSummary[]> {
  return queryClient.fetchQuery(
    userOrganizationsQueryOptions(axios.create(), userId),
  );
}

describe("organization query session and persistence", () => {
  it("persists a successful normal query refresh with updated organization details", async () => {
    const updated = {
      ...makeOrganization(),
      name: "Updated name",
      iconUrl: "/new.png",
    };
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([
      updated,
    ]);
    setItemToLocalStorage(
      ORGANIZATION_CONTEXT_LS,
      JSON.stringify({
        version: 1,
        userId: 7,
        organizations: [makeOrganization()],
      }),
    );

    await queryOrganizations();

    expect(
      JSON.parse(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS) ?? "null"),
    ).toEqual({ version: 1, userId: 7, organizations: [updated] });
  });

  it("removes an obsolete nonempty cache after an empty normal refresh", async () => {
    setItemToLocalStorage(
      ORGANIZATION_CONTEXT_LS,
      JSON.stringify({
        version: 1,
        userId: 7,
        organizations: [makeOrganization()],
      }),
    );
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([]);
    await queryOrganizations();
    expect(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS)).toBeNull();
  });

  it("refuses to fetch for a user other than the current session", async () => {
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([
      makeOrganization(),
    ]);
    await expect(queryOrganizations(8)).rejects.toThrow();
    expect(organizationService.fetchUserOrganizations).not.toHaveBeenCalled();
  });

  it.each(["logout", "other user", "same user new token"])(
    "rejects late success after %s without persisting or refilling memory",
    async (transition) => {
      const deferred = deferOrganizations();
      vi.mocked(organizationService.fetchUserOrganizations).mockReturnValue(
        deferred.promise,
      );
      const pending = queryOrganizations();
      const rejection = expect(pending).rejects.toThrow();
      if (transition === "logout") {
        store.set(logoutAtom);
      } else {
        store.set(
          loginAtom,
          makeLoginPayload(
            transition === "other user" ? 8 : 7,
            "replacement-session",
          ),
        );
      }
      deferred.resolve([makeOrganization()]);

      await rejection;

      expect(
        queryClient.getQueryData(organizationKeys.userOrganizations(7)),
      ).toBeUndefined();
      expect(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS)).toBeNull();
    },
  );

  it.each(["success", "empty", "failure"])(
    "preserves a replacement user's cache after old query %s",
    async (outcome) => {
      const deferred = deferOrganizations();
      vi.mocked(organizationService.fetchUserOrganizations).mockReturnValue(
        deferred.promise,
      );
      const pending = queryOrganizations();
      const rejection = expect(pending).rejects.toThrow();
      store.set(loginAtom, makeLoginPayload(8, "replacement-session"));
      const newCache = JSON.stringify({
        version: 1,
        userId: 8,
        organizations: [makeOrganization(20)],
      });
      setItemToLocalStorage(ORGANIZATION_CONTEXT_LS, newCache);
      queryClient.setQueryData(organizationKeys.userOrganizations(8), [
        makeOrganization(20),
      ]);
      if (outcome === "failure") {
        deferred.reject(new Error("old request failed"));
      } else {
        deferred.resolve(outcome === "empty" ? [] : [makeOrganization()]);
      }

      await rejection;

      expect(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS)).toBe(newCache);
      expect(
        queryClient.getQueryData(organizationKeys.userOrganizations(8)),
      ).toEqual([makeOrganization(20)]);
      expect(
        queryClient.getQueryData(organizationKeys.userOrganizations(7)),
      ).toBeUndefined();
    },
  );

  it("preserves newer same-user query data when an older token response arrives", async () => {
    const deferred = deferOrganizations();
    vi.mocked(organizationService.fetchUserOrganizations).mockReturnValue(
      deferred.promise,
    );
    const pending = queryOrganizations();
    const rejection = expect(pending).rejects.toThrow();
    store.set(loginAtom, makeLoginPayload(7, "replacement-session"));
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(20),
    ]);
    const newCache = JSON.stringify({
      version: 1,
      userId: 7,
      organizations: [makeOrganization(20)],
    });
    setItemToLocalStorage(ORGANIZATION_CONTEXT_LS, newCache);
    deferred.resolve([makeOrganization()]);

    await rejection;

    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual([makeOrganization(20)]);
    expect(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS)).toBe(newCache);
  });
});
