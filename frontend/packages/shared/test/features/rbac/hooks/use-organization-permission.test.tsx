import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import * as organizationService from "@/features/organization/services/organization";
import { useOrganizationPermission } from "@/features/rbac/hooks/use-organization-permission";
import * as rolesService from "@/features/rbac/services/user-role";
import { ApiClientProvider } from "@/services/api-client-context";
import { createTestApiClient } from "@/testing/create-test-api-client";
import { persistLoginPayload } from "@/utils/auth-storage";

import { makeLoginPayload } from "../../../helpers/organization-context";

vi.mock("@/features/organization/services/organization");
vi.mock("@/features/rbac/services/user-role");

const boundOrganization = {
  id: 9,
  name: "SICO",
  description: "",
  createdAt: 1,
  updatedAt: 1,
  creatorUsername: "owner@example.com",
  roleCodes: ["org_member" as const],
  isOwner: false,
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function wrapper(
  store = createStore(),
): (props: { children: ReactNode }) => ReactElement {
  store.set(userAtom, { id: 1, email: "admin@example.com", roles: [] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={createTestApiClient()}>
            {children}
          </ApiClientProvider>
        </QueryClientProvider>
      </Provider>
    );
  };
}

function expectNoActions(
  permission: ReturnType<typeof useOrganizationPermission>,
): void {
  expect(permission).toMatchObject({
    canRenameOrganization: false,
    canManageOrganizationMembers: false,
    canManageOrganizationDevices: false,
    canManage: false,
  });
}

beforeEach(() => {
  persistLoginPayload(makeLoginPayload(1));
  vi.mocked(organizationService.fetchUserOrganizations)
    .mockReset()
    .mockResolvedValue([boundOrganization]);
  vi.mocked(rolesService.fetchUserRoles).mockReset().mockResolvedValue([]);
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("organization permissions", () => {
  it("fails every capability closed while the bound organization is pending", () => {
    const organizations = deferred<(typeof boundOrganization)[]>();
    vi.mocked(organizationService.fetchUserOrganizations).mockReturnValue(
      organizations.promise,
    );
    vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
      { userId: 1, roleCode: "org_admin", scopeType: "org", scopeId: 9 },
    ]);

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    expect(result.current).toMatchObject({
      canEnterStudio: false,
      isLoading: true,
    });
    expectNoActions(result.current);
  });

  it("preserves pending status while initial queries are paused", () => {
    onlineManager.setOnline(false);

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.canEnterStudio).toBe(false);
  });

  it("fails every capability closed when the bound organization query fails", async () => {
    vi.mocked(organizationService.fetchUserOrganizations).mockRejectedValue(
      new Error("organization failed"),
    );

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.canEnterStudio).toBe(false);
    expectNoActions(result.current);
    expect(result.current.error).toEqual(new Error("organization failed"));
  });

  it("fails every capability closed without a bound organization", async () => {
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([]);
    vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
      { userId: 1, roleCode: "org_admin", scopeType: "org", scopeId: 9 },
    ]);

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canEnterStudio).toBe(false);
    expectNoActions(result.current);
  });

  it("keeps every capability closed while RBAC is pending", () => {
    const roles =
      deferred<Awaited<ReturnType<typeof rolesService.fetchUserRoles>>>();
    vi.mocked(rolesService.fetchUserRoles).mockReturnValue(roles.promise);

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.canEnterStudio).toBe(false);
    expectNoActions(result.current);
  });

  it("fails every capability closed when RBAC fails and reports the aggregate error", async () => {
    vi.mocked(rolesService.fetchUserRoles).mockRejectedValue(
      new Error("roles failed"),
    );

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.canEnterStudio).toBe(false);
    expectNoActions(result.current);
    expect(result.current.error).toEqual(new Error("roles failed"));
  });

  it("denies Studio and management actions to a matching org_member", async () => {
    vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
      { userId: 1, roleCode: "org_member", scopeType: "org", scopeId: 9 },
    ]);

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canEnterStudio).toBe(false);
    expectNoActions(result.current);
  });

  it("grants Studio without management actions to a matching developer", async () => {
    vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
      { userId: 1, roleCode: "developer", scopeType: "org", scopeId: 9 },
    ]);

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canEnterStudio).toBe(true);
    expectNoActions(result.current);
  });

  it("grants Studio and all management actions to matching org_admin", async () => {
    vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
      { userId: 1, roleCode: "org_admin", scopeType: "org", scopeId: 9 },
    ]);

    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({
      canEnterStudio: true,
      canRenameOrganization: true,
      canManageOrganizationMembers: true,
      canManageOrganizationDevices: true,
      canManage: true,
      currentUserId: 1,
      isError: false,
    });
  });

  it("removes admin capabilities when selection changes to an organization where the user is a member", async () => {
    const memberOrganization = {
      ...boundOrganization,
      id: 10,
      name: "Member organization",
    };
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([
      boundOrganization,
      memberOrganization,
    ]);
    vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
      { userId: 1, roleCode: "org_admin", scopeType: "org", scopeId: 9 },
      { userId: 1, roleCode: "org_member", scopeType: "org", scopeId: 10 },
    ]);
    const store = createStore();
    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(store),
    });
    await waitFor(() => expect(result.current.canManage).toBe(true));
    expect(result.current.canEnterStudio).toBe(true);

    act(() => store.set(selectedOrganizationIdAtom, memberOrganization.id));

    await waitFor(() => expect(result.current.canManage).toBe(false));
    expect(result.current.canEnterStudio).toBe(false);
    expectNoActions(result.current);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
    expect(rolesService.fetchUserRoles).toHaveBeenCalledOnce();
  });

  it.each(["developer", "org_admin"])(
    "does not apply a qualifying %s grant from another organization",
    async (roleCode) => {
      vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
        { userId: 1, roleCode, scopeType: "org", scopeId: 10 },
      ]);

      const { result } = renderHook(() => useOrganizationPermission(), {
        wrapper: wrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.canEnterStudio).toBe(false);
      expectNoActions(result.current);
    },
  );

  it.each([
    ["platform_admin", "platform", 0],
    ["project_admin", "project", 7],
  ])(
    "does not grant organization actions to %s",
    async (roleCode, scopeType, scopeId) => {
      vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
        { userId: 1, roleCode, scopeType, scopeId },
      ]);

      const { result } = renderHook(() => useOrganizationPermission(), {
        wrapper: wrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expectNoActions(result.current);
    },
  );

  it("fails every capability closed when organization refetch fails with stale data", async () => {
    vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
      { userId: 1, roleCode: "org_admin", scopeType: "org", scopeId: 9 },
    ]);
    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.canManage).toBe(true));
    const error = new Error("organization refetch failed");
    vi.mocked(organizationService.fetchUserOrganizations).mockRejectedValueOnce(
      error,
    );

    await result.current.refetch();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.canEnterStudio).toBe(false);
    expectNoActions(result.current);
    expect(result.current.error).toBe(error);
  });

  it("fails every capability closed when RBAC refetch fails with stale grants", async () => {
    vi.mocked(rolesService.fetchUserRoles).mockResolvedValue([
      { userId: 1, roleCode: "org_admin", scopeType: "org", scopeId: 9 },
    ]);
    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.canManage).toBe(true));
    const error = new Error("RBAC refetch failed");
    vi.mocked(rolesService.fetchUserRoles).mockRejectedValueOnce(error);

    await result.current.refetch();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.canEnterStudio).toBe(false);
    expectNoActions(result.current);
    expect(result.current.error).toBe(error);
  });

  it("refetches both organization and RBAC data", async () => {
    const { result } = renderHook(() => useOrganizationPermission(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.refetch();

    await waitFor(() =>
      expect(organizationService.fetchUserOrganizations).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(rolesService.fetchUserRoles).toHaveBeenCalledTimes(2);
  });
});
