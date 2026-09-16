import {
  QueryClient,
  QueryClientProvider,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { createStore, Provider } from "jotai";
import { type ReactElement, type ReactNode, Suspense } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import { organizationKeys } from "@/features/organization/query-keys";
import * as organizationService from "@/features/organization/services/organization";
import { useOrganizationPermissionSuspense } from "@/features/rbac/hooks/use-organization-permission";
import { rbacKeys } from "@/features/rbac/query-keys";
import type { UserRole } from "@/features/rbac/schemas/user-role";
import * as roleService from "@/features/rbac/services/user-role";
import { ApiClientProvider } from "@/services/api-client-context";
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

function QueryErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps): ReactElement {
  return (
    <div role="alert">
      <span>{error instanceof Error ? error.message : "failed"}</span>
      <button type="button" onClick={resetErrorBoundary}>
        Try again
      </button>
    </div>
  );
}

function QueryBoundary({ children }: { children: ReactNode }): ReactElement {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <ErrorBoundary onReset={reset} FallbackComponent={QueryErrorFallback}>
      <Suspense fallback={<div role="status">Loading permissions</div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function makeWrapper(staleTime = 30_000): {
  Wrapper: (props: { children: ReactNode }) => ReactElement;
  queryClient: QueryClient;
  store: ReturnType<typeof createStore>;
} {
  const store = createStore();
  store.set(userAtom, { id: 7, email: "user@example.com", roles: [] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime } },
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={axios.create()}>
            <QueryBoundary>{children}</QueryBoundary>
          </ApiClientProvider>
        </QueryClientProvider>
      </Provider>
    );
  }

  return { Wrapper, queryClient, store };
}

function seedPermission(
  queryClient: QueryClient,
  roles: readonly UserRole[],
  organizations: (typeof boundOrganization)[] = [boundOrganization],
): void {
  queryClient.setQueryData(
    organizationKeys.userOrganizations(7),
    organizations,
  );
  queryClient.setQueryData(rbacKeys.userRoles(7), roles);
}

function organizationRole(
  roleCode: UserRole["roleCode"],
  scopeId = 9,
): UserRole {
  return { userId: 7, roleCode, scopeType: "org", scopeId };
}

beforeEach(() => {
  persistLoginPayload(makeLoginPayload(7));
  vi.mocked(organizationService.fetchUserOrganizations)
    .mockReset()
    .mockResolvedValue([boundOrganization]);
  vi.mocked(roleService.fetchUserRoles).mockReset().mockResolvedValue([]);
});

describe("useOrganizationPermissionSuspense", () => {
  it("derives Studio access without management actions for a matching developer", () => {
    const { Wrapper, queryClient } = makeWrapper();
    seedPermission(queryClient, [organizationRole("developer")]);

    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(result.current).toEqual({
      canEnterStudio: true,
      canRenameOrganization: false,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
    });
  });

  it("derives Studio access and all management actions for a matching org_admin", () => {
    const { Wrapper, queryClient } = makeWrapper();
    seedPermission(queryClient, [organizationRole("org_admin")]);

    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(result.current).toEqual({
      canEnterStudio: true,
      canRenameOrganization: true,
      canManageOrganizationMembers: true,
      canManageOrganizationDevices: true,
      canManage: true,
    });
  });

  it("removes admin capabilities when selection changes to an organization where the user is a member", async () => {
    const memberOrganization = {
      ...boundOrganization,
      id: 10,
      name: "Member organization",
    };
    const { Wrapper, queryClient, store } = makeWrapper();
    seedPermission(
      queryClient,
      [organizationRole("org_admin"), organizationRole("org_member", 10)],
      [boundOrganization, memberOrganization],
    );
    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });
    expect(result.current.canManage).toBe(true);
    expect(result.current.canEnterStudio).toBe(true);

    act(() => store.set(selectedOrganizationIdAtom, memberOrganization.id));

    await waitFor(() => expect(result.current.canManage).toBe(false));
    expect(result.current).toEqual({
      canEnterStudio: false,
      canRenameOrganization: false,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
    });
    expect(organizationService.fetchUserOrganizations).not.toHaveBeenCalled();
    expect(roleService.fetchUserRoles).not.toHaveBeenCalled();
  });

  it("denies Studio and management actions to a matching org_member", () => {
    const { Wrapper, queryClient } = makeWrapper();
    seedPermission(queryClient, [organizationRole("org_member")]);

    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(result.current).toMatchObject({
      canEnterStudio: false,
      canManage: false,
    });
  });

  it("ignores qualifying grants outside the bound organization", () => {
    const { Wrapper, queryClient } = makeWrapper();
    seedPermission(queryClient, [organizationRole("org_admin", 10)]);

    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(result.current).toMatchObject({
      canEnterStudio: false,
      canManage: false,
    });
  });

  it("fails every capability closed without a bound organization", () => {
    const { Wrapper, queryClient } = makeWrapper();
    seedPermission(queryClient, [organizationRole("org_admin")], []);

    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(result.current).toEqual({
      canEnterStudio: false,
      canRenameOrganization: false,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
    });
  });

  it("reuses the bound-organization and raw-role caches", () => {
    const { Wrapper, queryClient } = makeWrapper();
    seedPermission(queryClient, [organizationRole("developer")]);

    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(result.current.canEnterStudio).toBe(true);
    expect(organizationService.fetchUserOrganizations).not.toHaveBeenCalled();
    expect(roleService.fetchUserRoles).not.toHaveBeenCalled();
  });

  it("suspends instead of returning capabilities while initial data is pending", async () => {
    vi.mocked(organizationService.fetchUserOrganizations).mockReturnValue(
      new Promise(() => {}),
    );
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Loading permissions",
    );
    expect(result.current).toBeNull();
  });

  it("surfaces bound-organization errors", async () => {
    vi.mocked(organizationService.fetchUserOrganizations).mockRejectedValue(
      new Error("organization failed"),
    );
    const { Wrapper } = makeWrapper();

    renderHook(() => useOrganizationPermissionSuspense(), { wrapper: Wrapper });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "organization failed",
    );
  });

  it("surfaces RBAC errors", async () => {
    vi.mocked(roleService.fetchUserRoles).mockRejectedValue(
      new Error("roles failed"),
    );
    const { Wrapper } = makeWrapper();

    renderHook(() => useOrganizationPermissionSuspense(), { wrapper: Wrapper });

    expect(await screen.findByRole("alert")).toHaveTextContent("roles failed");
  });

  it("fails closed while retrying a retained bound-organization error", async () => {
    let resolveRetry: (
      organizations: (typeof boundOrganization)[],
    ) => void = () => {};
    const retry = new Promise<(typeof boundOrganization)[]>((resolve) => {
      resolveRetry = resolve;
    });
    vi.mocked(organizationService.fetchUserOrganizations)
      .mockRejectedValueOnce(new Error("organization failed"))
      .mockReturnValueOnce(retry);
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(
      organizationKeys.userOrganizations(7),
      [boundOrganization],
      { updatedAt: 0 },
    );
    queryClient.setQueryData(rbacKeys.userRoles(7), [
      organizationRole("org_admin"),
    ]);
    const user = userEvent.setup();
    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "organization failed",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(result.current.canManage).toBe(false));
    expect(result.current.canEnterStudio).toBe(false);

    await act(async () => {
      resolveRetry([boundOrganization]);
      await retry;
    });
    await waitFor(() => expect(result.current.canManage).toBe(true));
  });

  it("fails closed while retrying a retained RBAC error", async () => {
    const roles = [organizationRole("org_admin")];
    let resolveRetry: (nextRoles: typeof roles) => void = () => {};
    const retry = new Promise<typeof roles>((resolve) => {
      resolveRetry = resolve;
    });
    vi.mocked(roleService.fetchUserRoles)
      .mockRejectedValueOnce(new Error("roles failed"))
      .mockReturnValueOnce(retry);
    const { Wrapper, queryClient } = makeWrapper(0);
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      boundOrganization,
    ]);
    queryClient.setQueryData(rbacKeys.userRoles(7), roles, { updatedAt: 0 });
    const user = userEvent.setup();
    const { result } = renderHook(() => useOrganizationPermissionSuspense(), {
      wrapper: Wrapper,
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("roles failed");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(result.current.canManage).toBe(false));
    expect(result.current.canEnterStudio).toBe(false);

    await act(async () => {
      resolveRetry(roles);
      await retry;
    });
    await waitFor(() => expect(result.current.canManage).toBe(true));
  });
});
