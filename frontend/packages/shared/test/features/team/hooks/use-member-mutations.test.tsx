import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as rbac from "@/features/rbac/services/user-role";
import { useChangeRoleMutation } from "@/features/team/hooks/use-change-role-mutation";
import { useInviteMemberMutation } from "@/features/team/hooks/use-invite-member-mutation";
import { PROJECT_MEMBERS_QUERY_KEY } from "@/features/team/hooks/use-project-members-query";
import { useRemoveMemberMutation } from "@/features/team/hooks/use-remove-member-mutation";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/rbac/services/user-role");

function makeWrapper(): {
  Wrapper: (props: { children: ReactNode }) => ReactElement;
  queryClient: QueryClient;
} {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  }

  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.mocked(rbac.assignUserRole).mockReset().mockResolvedValue(undefined);
  vi.mocked(rbac.removeUserRole).mockReset().mockResolvedValue(undefined);
});

describe("useInviteMemberMutation", () => {
  it("assigns the role scoped to the project", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInviteMemberMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({
      userId: 3,
      roleCode: "project_member",
    });
    expect(rbac.assignUserRole).toHaveBeenCalledWith(expect.anything(), {
      userId: 3,
      roleCode: "project_member",
      scopeId: 7,
      scopeType: "project",
    });
  });

  it("invites a member with a single role grant", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInviteMemberMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({ userId: 3, roleCode: "project_member" });
    expect(rbac.assignUserRole).toHaveBeenCalledTimes(1);
  });

  it("invites an admin in two grants: member base first, then admin overlay", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInviteMemberMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({ userId: 3, roleCode: "project_admin" });
    expect(rbac.assignUserRole).toHaveBeenCalledTimes(2);
    // Base member grant lands first, admin overlay second (order matters).
    expect(rbac.assignUserRole).toHaveBeenNthCalledWith(1, expect.anything(), {
      userId: 3,
      roleCode: "project_member",
      scopeId: 7,
      scopeType: "project",
    });
    expect(rbac.assignUserRole).toHaveBeenNthCalledWith(2, expect.anything(), {
      userId: 3,
      roleCode: "project_admin",
      scopeId: 7,
      scopeType: "project",
    });
  });

  it("invalidates the members query on success", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useInviteMemberMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({ userId: 3, roleCode: "project_admin" });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        queryKey: [PROJECT_MEMBERS_QUERY_KEY, 7],
      }),
    );
    // Also refreshes the project detail so the drawer's Team count updates.
    expect(spy).toHaveBeenCalledWith({ queryKey: ["projects", "detail", 7] });
  });
});

describe("useChangeRoleMutation", () => {
  it("promotes to admin by assigning project_admin (member base stays)", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChangeRoleMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({
      userId: 3,
      toRoleCode: "project_admin",
    });
    expect(rbac.assignUserRole).toHaveBeenCalledWith(expect.anything(), {
      userId: 3,
      roleCode: "project_admin",
      scopeId: 7,
      scopeType: "project",
    });
    // Additive model — no member grant is written or removed.
    expect(rbac.removeUserRole).not.toHaveBeenCalled();
  });

  it("demotes to member by removing project_admin (no member re-assign)", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useChangeRoleMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({
      userId: 3,
      toRoleCode: "project_member",
    });
    expect(rbac.removeUserRole).toHaveBeenCalledWith(expect.anything(), {
      userId: 3,
      roleCode: "project_admin",
      scopeId: 7,
      scopeType: "project",
    });
    // The member base was already there — nothing is assigned.
    expect(rbac.assignUserRole).not.toHaveBeenCalled();
  });

  it("optimistically flips the member's role in the cache", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(
      [PROJECT_MEMBERS_QUERY_KEY, 7],
      [{ id: 3, email: "a@x.com", roleCode: "project_member" }],
    );
    const { result } = renderHook(() => useChangeRoleMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({
      userId: 3,
      toRoleCode: "project_admin",
    });
    expect(queryClient.getQueryData([PROJECT_MEMBERS_QUERY_KEY, 7])).toEqual([
      { id: 3, email: "a@x.com", roleCode: "project_admin" },
    ]);
  });

  it("rolls the cache back when the role assignment fails", async () => {
    vi.mocked(rbac.assignUserRole).mockRejectedValue(new Error("nope"));
    const { Wrapper, queryClient } = makeWrapper();
    const before = [{ id: 3, email: "a@x.com", roleCode: "project_member" }];
    queryClient.setQueryData([PROJECT_MEMBERS_QUERY_KEY, 7], before);
    const { result } = renderHook(() => useChangeRoleMutation(7), {
      wrapper: Wrapper,
    });
    await expect(
      result.current.mutateAsync({ userId: 3, toRoleCode: "project_admin" }),
    ).rejects.toThrow("nope");
    expect(queryClient.getQueryData([PROJECT_MEMBERS_QUERY_KEY, 7])).toEqual(
      before,
    );
  });

  it("invalidates the RBAC user-roles cache so self-role gates update", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useChangeRoleMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({
      userId: 3,
      toRoleCode: "project_admin",
    });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        queryKey: ["rbac", "user-roles"],
        exact: false,
      }),
    );
  });
});

describe("useRemoveMemberMutation", () => {
  it("removes a plain member with a single delete", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRemoveMemberMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({
      userId: 3,
      roleCode: "project_member",
    });
    expect(rbac.removeUserRole).toHaveBeenCalledTimes(1);
    expect(rbac.removeUserRole).toHaveBeenCalledWith(expect.anything(), {
      userId: 3,
      roleCode: "project_member",
      scopeId: 7,
      scopeType: "project",
    });
  });

  it("removes an admin in two deletes: admin overlay first, then member base", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRemoveMemberMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({
      userId: 3,
      roleCode: "project_admin",
    });
    expect(rbac.removeUserRole).toHaveBeenCalledTimes(2);
    // Peel the admin overlay first, then the member base (order matters).
    expect(rbac.removeUserRole).toHaveBeenNthCalledWith(1, expect.anything(), {
      userId: 3,
      roleCode: "project_admin",
      scopeId: 7,
      scopeType: "project",
    });
    expect(rbac.removeUserRole).toHaveBeenNthCalledWith(2, expect.anything(), {
      userId: 3,
      roleCode: "project_member",
      scopeId: 7,
      scopeType: "project",
    });
  });

  it("invalidates the RBAC user-roles cache so self-removal drops gates", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRemoveMemberMutation(7), {
      wrapper: Wrapper,
    });
    await result.current.mutateAsync({ userId: 3, roleCode: "project_admin" });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        queryKey: ["rbac", "user-roles"],
        exact: false,
      }),
    );
  });
});
