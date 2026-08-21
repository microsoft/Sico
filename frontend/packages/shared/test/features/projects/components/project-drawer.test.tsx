import { render, type RenderResult, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDrawer } from "@/features/projects/components/project-drawer";
import { useKnowledgeTagsQuery } from "@/features/projects/hooks/use-knowledge-tags-query";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import {
  MemberTypeSchema,
  type ProjectDetail,
  type ProjectSandboxDigest,
} from "@/features/projects/schemas/project";
import { deriveCapabilities } from "@/features/rbac/capabilities";

// Only Knowledge tags self-fetch now (via its retained SilentSection); permission
// + roster + sandboxes come from props, so mock only the tags query.
vi.mock("@/features/projects/hooks/use-knowledge-tags-query", () => ({
  useKnowledgeTagsQuery: vi.fn(),
}));

// The "view more" affordances are real router `<Link>`s. Stub Link to a plain
// `<a>` (resolving `$projectId`) so tests assert on `href` without a router.
vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
      className,
      "aria-label": ariaLabel,
    }: {
      to: string;
      params?: { projectId: string };
      children?: React.ReactNode;
      className?: string;
      "aria-label"?: string;
    }): React.JSX.Element => (
      <a
        href={params ? to.replace("$projectId", params.projectId) : to}
        className={className}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    ),
  };
});

const mockedTags = vi.mocked(useKnowledgeTagsQuery);

// Capabilities the drawer takes as a prop — default to an admin (all-true).
function adminPermission(): {
  canManageProject: boolean;
  canInviteDw: boolean;
} {
  const c = deriveCapabilities("project_admin");
  return { canManageProject: c.canManageProject, canInviteDw: c.canInviteDw };
}

// No capabilities — a non-member / not-yet-resolved viewer.
const NO_PERMISSION = { canManageProject: false, canInviteDw: false };

function makeProject(partial: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 1,
    name: "E-commerce Platform",
    description: "A short project summary.",
    iconUrl: "",
    memberType: MemberTypeSchema.enum.OWNER,
    agentInstances: [
      { id: 1, iconUrl: "" },
      { id: 2, iconUrl: "" },
    ],
    ownerUsername: "owner@microsoft.com",
    creatorUsername: "amy@microsoft.com",
    operatorAdmins: ["jessica@microsoft.com", "michael@microsoft.com"],
    projectMembers: [],
    projectAdmins: [],
    sandboxes: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function makeSandbox(
  partial: Partial<ProjectSandboxDigest> = {},
): ProjectSandboxDigest {
  return { sandboxId: "s1", type: "wincua", status: "available", ...partial };
}

function makeKnowledgeTag(partial: Partial<KnowledgeTag> = {}): KnowledgeTag {
  return {
    id: 1,
    projectId: 1,
    name: "Knowledge tag",
    description: "",
    creatorUsername: "amy@microsoft.com",
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function setTags(items: KnowledgeTag[]): void {
  mockedTags.mockReturnValue({
    data: { items, total: items.length, hasNext: false },
  } as never);
}

type Props = Parameters<typeof ProjectDrawer>[0];
type Setup = RenderResult & { props: Required<Props>; user: UserEvent };

function setup(overrides: Partial<Props> = {}): Setup {
  const props: Required<Props> = {
    project: makeProject(),
    projectId: 1,
    permission: adminPermission(),
    onEditProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onInviteHuman: vi.fn(),
    onInviteDw: vi.fn(),
    onToggleCollapse: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  const result = render(
    <ProjectDrawer
      project={props.project}
      projectId={props.projectId}
      permission={props.permission}
      onEditProject={props.onEditProject}
      onDeleteProject={props.onDeleteProject}
      onInviteHuman={props.onInviteHuman}
      onInviteDw={props.onInviteDw}
      onToggleCollapse={props.onToggleCollapse}
    />,
  );
  return { ...result, props, user };
}

beforeEach(() => {
  vi.clearAllMocks();
  setTags([]);
});

describe("ProjectDrawer", () => {
  it("renders the Team title and total worker count", () => {
    setup({
      project: makeProject({
        ownerUsername: "owner@microsoft.com",
        projectMembers: [
          { id: 1, username: "owner@microsoft.com", email: "owner@x.com" },
          { id: 2, username: "jessica@microsoft.com", email: "jess@x.com" },
          { id: 3, username: "michael@microsoft.com", email: "mike@x.com" },
        ],
        agentInstances: [
          { id: 1, iconUrl: "" },
          { id: 2, iconUrl: "" },
          { id: 3, iconUrl: "" },
        ],
      }),
    });
    // The preview counts the full member roster + DWs (3 members + 3 DWs = 6),
    // rendered as "{total} workers". Owner is already in projectMembers, so it
    // isn't double-counted.
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("6 workers")).toBeInTheDocument();
  });

  it("links the members preview to the operators page", () => {
    setup();
    expect(screen.getByRole("link", { name: /workers/ })).toHaveAttribute(
      "href",
      "/project/1/team/operators",
    );
  });

  it("opens the invite-human dialog from the Invite menu", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Human Operator" }),
    );
    expect(props.onInviteHuman).toHaveBeenCalledTimes(1);
    expect(props.onInviteDw).not.toHaveBeenCalled();
  });

  it("opens the invite-dw dialog from the Invite menu", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Digital Worker" }),
    );
    expect(props.onInviteDw).toHaveBeenCalledTimes(1);
    expect(props.onInviteHuman).not.toHaveBeenCalled();
  });

  it("hides the Invite menu for a non-admin", () => {
    setup({ permission: NO_PERMISSION });
    expect(
      screen.queryByRole("button", { name: "Invite" }),
    ).not.toBeInTheDocument();
  });

  it("renders a Sandbox row with real availability and links to View all", () => {
    setup({
      project: makeProject({
        sandboxes: [
          makeSandbox({ sandboxId: "a", status: "available" }),
          makeSandbox({ sandboxId: "b", status: "available" }),
          makeSandbox({ sandboxId: "c", status: "assigned" }),
          makeSandbox({ sandboxId: "d", status: "assigned" }),
          makeSandbox({ sandboxId: "e", status: "assigned" }),
        ],
      }),
    });
    expect(screen.getByText("Windows")).toBeInTheDocument();
    expect(screen.getByText("2 / 5 available")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View all devices" }),
    ).toHaveAttribute("href", "/project/1/sandbox");
  });

  it("shows a plain empty text line when the project has no sandbox devices", () => {
    setup({ project: makeProject({ sandboxes: [] }) });
    expect(screen.getByText("No devices yet.")).toBeInTheDocument();
    // Empty state is text-only — no View all affordance.
    expect(
      screen.queryByRole("link", { name: "View all devices" }),
    ).not.toBeInTheDocument();
  });

  it("hides the edit button for a non-admin", () => {
    setup({ permission: NO_PERMISSION });
    expect(
      screen.queryByRole("button", { name: "Edit project" }),
    ).not.toBeInTheDocument();
  });

  it("shows the actions menu with Delete project for an admin", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Delete project" }),
    ).toBeInTheDocument();
  });

  it("hides the actions menu for a non-admin", () => {
    setup({ permission: NO_PERMISSION });
    expect(
      screen.queryByRole("button", { name: "Project actions" }),
    ).not.toBeInTheDocument();
  });

  it("raises onDeleteProject when Delete project is clicked", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Project actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete project" }),
    );
    expect(props.onDeleteProject).toHaveBeenCalledTimes(1);
  });

  it("shows the edit button for an admin", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Edit project" }),
    ).toBeInTheDocument();
  });

  it("shows View all only when knowledge tags exceed three", () => {
    const many = [1, 2, 3, 4].map((n) =>
      makeKnowledgeTag({ id: n, name: `Knowledge tag ${n}` }),
    );
    setTags(many);
    const { unmount } = setup();
    expect(screen.getByRole("link", { name: "View all" })).toBeInTheDocument();
    unmount();
    setTags(many.slice(0, 3));
    setup();
    expect(
      screen.queryByRole("link", { name: "View all" }),
    ).not.toBeInTheDocument();
  });

  it("calls onEditProject when the edit button is clicked", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Edit project" }));
    expect(props.onEditProject).toHaveBeenCalledTimes(1);
  });

  it("links View all to the knowledge-tags page", () => {
    const many = [1, 2, 3, 4].map((n) =>
      makeKnowledgeTag({ id: n, name: `Knowledge tag ${n}` }),
    );
    setTags(many);
    setup();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/project/1/knowledge-tags",
    );
  });
});
