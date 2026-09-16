import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logoutAtom, userAtom } from "@/atoms/auth-atom";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import { organizationKeys } from "@/features/organization/query-keys";
import { type OrganizationSummary } from "@/features/organization/schemas/organization";
import { getBoundOrganizationId } from "@/services/bound-organization";
import {
  removeItemFromLocalStorage,
  SELECTED_ORGANIZATION_ID_LS,
} from "@/utils/local-storage";

function makeOrganization(id: number): OrganizationSummary {
  return {
    id,
    name: `Organization ${id}`,
    description: "",
    createdAt: 1,
    updatedAt: 1,
    creatorUsername: "owner@example.com",
    roleCodes: [],
    isOwner: false,
  };
}

let store: ReturnType<typeof createStore>;
let queryClient: QueryClient;

beforeEach(() => {
  removeItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
  store = createStore();
  store.set(userAtom, { id: 7, email: "user@example.com", roles: [] });
  queryClient = new QueryClient();
});

afterEach(() => {
  queryClient.clear();
  removeItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
});

describe("getBoundOrganizationId", () => {
  it("omits an unverified stored selection before organizations load", () => {
    store.set(selectedOrganizationIdAtom, 9);

    expect(getBoundOrganizationId(store, queryClient)).toBeNull();
  });

  it("uses the first organization when no selection was saved", () => {
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
      makeOrganization(10),
    ]);

    expect(getBoundOrganizationId(store, queryClient)).toBe(9);
  });

  it("uses the selected organization from the current user's list", () => {
    store.set(selectedOrganizationIdAtom, 10);
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
      makeOrganization(10),
    ]);

    expect(getBoundOrganizationId(store, queryClient)).toBe(10);
  });

  it("falls back to the first organization for an obsolete selection", () => {
    store.set(selectedOrganizationIdAtom, 99);
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
    ]);

    expect(getBoundOrganizationId(store, queryClient)).toBe(9);
  });

  it("does not overwrite the selection preference when resolving a fallback", () => {
    store.set(selectedOrganizationIdAtom, 99);
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
    ]);

    getBoundOrganizationId(store, queryClient);

    expect(store.get(selectedOrganizationIdAtom)).toBe(99);
  });

  it("omits the organization for an empty list", () => {
    store.set(selectedOrganizationIdAtom, 9);
    queryClient.setQueryData(organizationKeys.userOrganizations(7), []);

    expect(getBoundOrganizationId(store, queryClient)).toBeNull();
  });

  it("reads a changed selection synchronously", () => {
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
      makeOrganization(10),
    ]);
    getBoundOrganizationId(store, queryClient);
    store.set(selectedOrganizationIdAtom, 10);

    expect(getBoundOrganizationId(store, queryClient)).toBe(10);
  });

  it("reads organizations that arrived after the first lookup", () => {
    getBoundOrganizationId(store, queryClient);
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
    ]);

    expect(getBoundOrganizationId(store, queryClient)).toBe(9);
  });

  it("does not reuse another user's cached organizations", () => {
    store.set(selectedOrganizationIdAtom, 9);
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
    ]);
    store.set(userAtom, { id: 8, email: "other@example.com", roles: [] });

    expect(getBoundOrganizationId(store, queryClient)).toBeNull();
  });

  it("resolves a retained preference against the new user's own list", () => {
    store.set(selectedOrganizationIdAtom, 9);
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
    ]);
    queryClient.setQueryData(organizationKeys.userOrganizations(8), [
      makeOrganization(20),
    ]);
    store.set(userAtom, { id: 8, email: "other@example.com", roles: [] });

    expect(getBoundOrganizationId(store, queryClient)).toBe(20);
  });

  it("omits the organization after logout even with a cached list", () => {
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(9),
    ]);
    store.set(logoutAtom);

    expect(getBoundOrganizationId(store, queryClient)).toBeNull();
  });

  it("does not fetch organizations to resolve an uncached selection", () => {
    const queryFn = vi.fn();
    queryClient.setQueryDefaults(organizationKeys.userOrganizations(7), {
      queryFn,
    });

    getBoundOrganizationId(store, queryClient);

    expect(queryFn).not.toHaveBeenCalled();
  });
});
