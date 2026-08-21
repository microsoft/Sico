import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectDetailQuery } from "@/features/projects/hooks/use-project-query";
import { deriveCapabilities } from "@/features/rbac/capabilities";
import { useProjectPermission } from "@/features/rbac/hooks/use-project-permission";
import { MembersPersonTab } from "@/features/team/components/members-person-tab";
import { useChangeRoleMutation } from "@/features/team/hooks/use-change-role-mutation";
import { useProjectMembersSuspenseQuery } from "@/features/team/hooks/use-project-members-query";
import { useRemoveMemberMutation } from "@/features/team/hooks/use-remove-member-mutation";
import { type ProjectMember } from "@/features/team/schemas/member";

vi.mock("@/features/rbac/hooks/use-project-permission", () => ({
  useProjectPermission: vi.fn(),
}));

vi.mock("@/features/team/hooks/use-project-members-query", () => ({
  useProjectMembersSuspenseQuery: vi.fn(),
}));

vi.mock("@/features/projects/hooks/use-project-query", () => ({
  useProjectDetailQuery: vi.fn(),
}));

vi.mock("@/features/team/hooks/use-change-role-mutation", () => ({
  useChangeRoleMutation: vi.fn(),
}));

vi.mock("@/features/team/hooks/use-remove-member-mutation", () => ({
  useRemoveMemberMutation: vi.fn(),
}));

const mockedUseProjectPermission = vi.mocked(useProjectPermission);
const mockedUseMembers = vi.mocked(useProjectMembersSuspenseQuery);
const mockedUseProjectDetail = vi.mocked(useProjectDetailQuery);
const mockedUseChangeRole = vi.mocked(useChangeRoleMutation);
const mockedUseRemoveMember = vi.mocked(useRemoveMemberMutation);

function makeMember(partial: Partial<ProjectMember> = {}): ProjectMember {
  return {
    id: 1,
    email: "amy@company.com",
    roleCode: "project_member",
    ...partial,
  };
}

function mockMutation(): { mutate: ReturnType<typeof vi.fn> } {
  return { mutate: vi.fn() };
}

function setPermission(isAdmin: boolean): void {
  mockedUseProjectPermission.mockReturnValue({
    ...deriveCapabilities(isAdmin ? "project_admin" : "project_member"),
    userEmail: "me@company.com",
    isLoading: false,
    isError: false,
  });
}

function renderTab(): void {
  render(<MembersPersonTab projectId={7} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseChangeRole.mockReturnValue(
    mockMutation() as unknown as ReturnType<typeof useChangeRoleMutation>,
  );
  mockedUseRemoveMember.mockReturnValue(
    mockMutation() as unknown as ReturnType<typeof useRemoveMemberMutation>,
  );
  mockedUseMembers.mockReturnValue({
    data: [makeMember()],
  } as unknown as ReturnType<typeof useProjectMembersSuspenseQuery>);
  // The member (amy@) is not the owner, so its actions render normally.
  mockedUseProjectDetail.mockReturnValue({
    data: { ownerUsername: "owner@company.com" },
  } as unknown as ReturnType<typeof useProjectDetailQuery>);
});

describe("MembersPersonTab RBAC gating", () => {
  it("shows per-row actions for an admin", () => {
    setPermission(true);
    renderTab();

    expect(
      screen.getByRole("button", { name: "Member actions" }),
    ).toBeInTheDocument();
  });

  it("renders rows read-only for a non-admin", () => {
    setPermission(false);
    renderTab();

    // The `···` trigger opens for everyone; the Remove item inside is gated
    // (covered by the humans-table unit tests). The role column is read-only.
    expect(
      screen.getByRole("button", { name: "Member actions" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    // The member itself still renders — only the write affordances are gated.
    expect(screen.getByText("amy@company.com")).toBeInTheDocument();
    // Read-only role text uses the members-page label mapping (project_member → Member).
    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("keeps the actions trigger reachable while the permission query is loading", () => {
    mockedUseProjectPermission.mockReturnValue({
      ...deriveCapabilities(null),
      userEmail: "me@company.com",
      isLoading: true,
      isError: false,
    });
    renderTab();

    expect(
      screen.getByRole("button", { name: "Member actions" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the actions trigger reachable when the permission query errors", () => {
    mockedUseProjectPermission.mockReturnValue({
      ...deriveCapabilities(null),
      userEmail: "me@company.com",
      isLoading: false,
      isError: true,
    });
    renderTab();

    expect(
      screen.getByRole("button", { name: "Member actions" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("renders the empty state when there are no members", () => {
    setPermission(true);
    mockedUseMembers.mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useProjectMembersSuspenseQuery>);
    renderTab();

    expect(screen.getByText("No members yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "NAME" }),
    ).not.toBeInTheDocument();
  });
});

describe("MembersPersonTab LAST ACTIVE", () => {
  it("renders each member's own updatedAt", () => {
    setPermission(true);
    // 1784540848 = epoch SECONDS → Jul 2026 (the per-member RBAC contract).
    mockedUseMembers.mockReturnValue({
      data: [makeMember({ updatedAt: 1784540848 })],
    } as unknown as ReturnType<typeof useProjectMembersSuspenseQuery>);
    renderTab();

    expect(screen.getByRole("cell", { name: /2026/ })).toBeInTheDocument();
  });

  it("leaves the cell blank when a member has no updatedAt", () => {
    setPermission(true);
    mockedUseMembers.mockReturnValue({
      data: [makeMember()],
    } as unknown as ReturnType<typeof useProjectMembersSuspenseQuery>);
    renderTab();

    // No timestamp renders anywhere in the row.
    expect(
      screen.queryByRole("cell", { name: /2026/ }),
    ).not.toBeInTheDocument();
  });
});
