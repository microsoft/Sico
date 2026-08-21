import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectDetailQuery } from "@/features/projects/hooks/use-project-query";
import {
  MemberTypeSchema,
  type ProjectDetail,
} from "@/features/projects/schemas/project";
import { deriveCapabilities } from "@/features/rbac/capabilities";
import { useProjectPermission } from "@/features/rbac/hooks/use-project-permission";
import { MembersPage } from "@/features/team/components/members-page";

// Router: capture the `to`/`params` each tab Link renders so we can assert the
// two tabs point at the humans / digital-workers routes, and stub useNavigate.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/features/projects/hooks/use-project-query", () => ({
  useProjectDetailQuery: vi.fn(),
}));

vi.mock("@/features/rbac/hooks/use-project-permission", () => ({
  useProjectPermission: vi.fn(),
}));

// Stub each tab body to a presence marker so the page test never boots their
// suspending internals — the page only chooses which one to mount.
vi.mock("@/features/team/components/members-person-tab", () => ({
  MembersPersonTab: () => <div>humans-tab</div>,
}));

vi.mock("@/features/team/components/members-dw-tab", () => ({
  MembersDwTab: () => <div>workers-tab</div>,
}));

vi.mock("@/features/team/components/invite-member-dialog", () => ({
  InviteMemberDialog: () => null,
}));

vi.mock("@/features/team/components/invite-dw-dialog", () => ({
  InviteDwDialog: () => null,
}));

const mockedUseProjectDetail = vi.mocked(useProjectDetailQuery);
const mockedUseProjectPermission = vi.mocked(useProjectPermission);

function makeProject(partial: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 7,
    name: "Atlas",
    description: "",
    iconUrl: "",
    memberType: MemberTypeSchema.enum.OWNER,
    agentInstances: [],
    ownerUsername: "owner@company.com",
    creatorUsername: "amy@company.com",
    operatorAdmins: [],
    projectMembers: [],
    projectAdmins: [],
    sandboxes: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseProjectDetail.mockReturnValue({ data: makeProject() } as never);
  mockedUseProjectPermission.mockReturnValue({
    ...deriveCapabilities("project_admin"),
    userEmail: "me@company.com",
    isLoading: false,
    isError: false,
  });
});

describe("MembersPage", () => {
  it("mounts the humans tab body when activeTab is humans", () => {
    render(<MembersPage projectId={7} activeTab="humans" />);
    expect(screen.getByText("humans-tab")).toBeInTheDocument();
    expect(screen.queryByText("workers-tab")).not.toBeInTheDocument();
  });

  it("mounts the digital-workers tab body when activeTab is workers", () => {
    render(<MembersPage projectId={7} activeTab="workers" />);
    expect(screen.getByText("workers-tab")).toBeInTheDocument();
    expect(screen.queryByText("humans-tab")).not.toBeInTheDocument();
  });

  it("links the two tabs to their own routes", () => {
    render(<MembersPage projectId={7} activeTab="humans" />);
    expect(
      screen.getByRole("link", { name: "Human Operators" }),
    ).toHaveAttribute("href", "/project/$projectId/team/operators");
    expect(
      screen.getByRole("link", { name: "Digital Workers" }),
    ).toHaveAttribute("href", "/project/$projectId/team/digital-workers");
  });

  it("shows the Invite control for admins", () => {
    render(<MembersPage projectId={7} activeTab="humans" />);
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
  });

  it("hides the Invite control for non-admins", () => {
    mockedUseProjectPermission.mockReturnValue({
      ...deriveCapabilities(null),
      userEmail: "me@company.com",
      isLoading: false,
      isError: false,
    });
    render(<MembersPage projectId={7} activeTab="humans" />);
    expect(
      screen.queryByRole("button", { name: "Invite" }),
    ).not.toBeInTheDocument();
  });
});
