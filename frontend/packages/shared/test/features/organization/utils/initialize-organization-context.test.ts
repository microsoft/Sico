import { QueryClient } from "@tanstack/react-query";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loginAtom } from "@/atoms/auth-atom";
import { organizationKeys } from "@/features/organization/query-keys";
import type { OrganizationSummary } from "@/features/organization/schemas/organization";
import * as organizationService from "@/features/organization/services/organization";
import { initializeOrganizationContext } from "@/features/organization/utils/initialize-organization-context";
import { createApiClient } from "@/services/axios";
import { getBoundOrganizationId } from "@/services/bound-organization";
import { clearAuthStorage } from "@/utils/auth-storage";
import {
  getItemFromLocalStorage,
  ORGANIZATION_CONTEXT_LS,
  SELECTED_ORGANIZATION_ID_LS,
  setItemToLocalStorage,
} from "@/utils/local-storage";

import {
  deferOrganizations,
  makeLoginPayload,
  makeOrganization,
} from "../../../helpers/organization-context";

vi.mock("@/features/organization/services/organization");

let queryClient: QueryClient;
let store: ReturnType<typeof createStore>;

function cacheOrganizations(
  userId = 7,
  organizations: OrganizationSummary[] = [makeOrganization()],
): void {
  setItemToLocalStorage(
    ORGANIZATION_CONTEXT_LS,
    JSON.stringify({ version: 1, userId, organizations }),
  );
}

beforeEach(() => {
  clearAuthStorage();
  store = createStore();
  store.set(loginAtom, makeLoginPayload());
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.mocked(organizationService.fetchUserOrganizations).mockReset();
  vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([
    makeOrganization(),
  ]);
});

afterEach(() => {
  queryClient.clear();
  clearAuthStorage();
});

describe("initializeOrganizationContext", () => {
  it("prefers the current user's memory list over persisted organizations", async () => {
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      makeOrganization(10),
    ]);
    cacheOrganizations();

    await initializeOrganizationContext(axios.create(), queryClient, 7);

    expect(getBoundOrganizationId(store, queryClient)).toBe(10);
    expect(organizationService.fetchUserOrganizations).not.toHaveBeenCalled();
  });

  it("does not fetch again for an already resolved empty memory list", async () => {
    queryClient.setQueryData(organizationKeys.userOrganizations(7), []);
    cacheOrganizations();

    await initializeOrganizationContext(axios.create(), queryClient, 7);

    expect(getBoundOrganizationId(store, queryClient)).toBeNull();
    expect(organizationService.fetchUserOrganizations).not.toHaveBeenCalled();
  });

  it.each([
    { selection: "10", expected: 10 },
    { selection: "999", expected: 9 },
    { selection: "null", expected: 9 },
  ])(
    "restores cached organizations and header context for selection $selection without fetching",
    async ({ selection, expected }) => {
      cacheOrganizations(7, [makeOrganization(), makeOrganization(10)]);
      setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, selection);
      store = createStore();
      const apiClient = createApiClient({
        store,
        getOrganizationId: () => getBoundOrganizationId(store, queryClient),
      });
      const mock = new MockAdapter(apiClient);
      mock.onGet("/protected").reply(200, { code: 0, msg: "ok", data: {} });

      await initializeOrganizationContext(apiClient, queryClient, 7);
      await apiClient.get("/protected");

      expect(
        queryClient.getQueryData(organizationKeys.userOrganizations(7)),
      ).toEqual([makeOrganization(), makeOrganization(10)]);
      expect(mock.history.get[0]?.headers?.["X-Sico-Organization-ID"]).toBe(
        String(expected),
      );
      expect(organizationService.fetchUserOrganizations).not.toHaveBeenCalled();
      mock.restore();
    },
  );

  it.each([
    [
      "wrong user",
      { version: 1, userId: 8, organizations: [makeOrganization(20)] },
    ],
    [
      "wrong version",
      { version: 2, userId: 7, organizations: [makeOrganization(20)] },
    ],
    ["empty list", { version: 1, userId: 7, organizations: [] }],
    ["missing fields", { version: 1, userId: 7, organizations: [{ id: 20 }] }],
    [
      "zero ID",
      { version: 1, userId: 7, organizations: [makeOrganization(0)] },
    ],
    [
      "negative ID",
      { version: 1, userId: 7, organizations: [makeOrganization(-1)] },
    ],
    [
      "fraction ID",
      { version: 1, userId: 7, organizations: [makeOrganization(1.5)] },
    ],
    [
      "unsafe ID",
      {
        version: 1,
        userId: 7,
        organizations: [makeOrganization(Number.MAX_SAFE_INTEGER + 1)],
      },
    ],
  ])("fetches for %s persisted cache", async (_label, cache) => {
    setItemToLocalStorage(ORGANIZATION_CONTEXT_LS, JSON.stringify(cache));

    await initializeOrganizationContext(axios.create(), queryClient, 7);

    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
    expect(getBoundOrganizationId(store, queryClient)).toBe(9);
  });

  it("fetches for corrupt JSON", async () => {
    setItemToLocalStorage(ORGANIZATION_CONTEXT_LS, "{broken");
    await initializeOrganizationContext(axios.create(), queryClient, 7);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
  });

  it("fetches for a legacy selection without a list", async () => {
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, "20");
    await initializeOrganizationContext(axios.create(), queryClient, 7);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
    expect(getBoundOrganizationId(store, queryClient)).toBe(9);
  });

  it("ignores another user's memory list", async () => {
    queryClient.setQueryData(organizationKeys.userOrganizations(8), [
      makeOrganization(20),
    ]);
    await initializeOrganizationContext(axios.create(), queryClient, 7);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
  });

  it("waits for a cold query and reuses its saved cache on the next cold start", async () => {
    const deferred = deferOrganizations();
    vi.mocked(organizationService.fetchUserOrganizations).mockReturnValue(
      deferred.promise,
    );
    const initialized = initializeOrganizationContext(
      axios.create(),
      queryClient,
      7,
    );
    expect(getBoundOrganizationId(store, queryClient)).toBeNull();
    deferred.resolve([makeOrganization()]);
    await initialized;
    queryClient.clear();

    await initializeOrganizationContext(axios.create(), queryClient, 7);

    expect(getBoundOrganizationId(store, queryClient)).toBe(9);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent cold initialization", async () => {
    const apiClient = axios.create();
    await Promise.all([
      initializeOrganizationContext(apiClient, queryClient, 7),
      initializeOrganizationContext(apiClient, queryClient, 7),
    ]);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
  });

  it("rejects a failed organization query rather than caching an empty list", async () => {
    const error = new Error("organization failed");
    vi.mocked(organizationService.fetchUserOrganizations).mockRejectedValue(
      error,
    );
    await expect(
      initializeOrganizationContext(axios.create(), queryClient, 7),
    ).rejects.toBe(error);
    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toBeUndefined();
    expect(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS)).toBeNull();
  });

  it("keeps an empty success only in memory", async () => {
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([]);
    await initializeOrganizationContext(axios.create(), queryClient, 7);
    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual([]);
    expect(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS)).toBeNull();
  });
});
