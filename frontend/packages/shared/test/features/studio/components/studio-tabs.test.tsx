import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type PermissionSnapshot } from "@/features/rbac/permission-snapshot";
import { Studio } from "@/features/studio/components/studio";
import {
  SingleAgentPublishStatusSchema,
  type StudioAgent,
} from "@/features/studio/schemas/studio-agent";

const mockStudioAgentsQuery = vi.fn();
const mockOrganizationQuery = vi.fn();
const mockPermissionSnapshotQuery = vi.fn();
const mockUser = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    to: string;
    "aria-label"?: string;
  }) => (
    <a href={to} aria-label={ariaLabel}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("jotai", async () => {
  const actual = await vi.importActual<typeof import("jotai")>("jotai");
  return { ...actual, useAtomValue: () => mockUser() };
});

vi.mock("@/hooks/use-bound-organization", () => ({
  useBoundOrganizationQuery: () => mockOrganizationQuery(),
  useBoundOrganizationSuspenseQuery: () => mockOrganizationQuery(),
}));

vi.mock("@/features/rbac/hooks/use-permission-snapshot", () => ({
  usePermissionSnapshotSuspenseQuery: () => mockPermissionSnapshotQuery(),
}));

vi.mock("@/features/studio/hooks/use-studio-agents-query", () => ({
  useStudioAgentsSuspenseQuery: () => mockStudioAgentsQuery(),
}));

function makeAgent(partial: Partial<StudioAgent> = {}): StudioAgent {
  return {
    agentId: "00000000-0000-4000-8000-000000000001",
    name: "Researcher",
    role: "Researcher",
    desc: "Researches",
    creatorUsername: "me",
    organizationId: 7,
    publishStatus: SingleAgentPublishStatusSchema.enum.DRAFT,
    ...partial,
  };
}

function makePermissions(agentIds: readonly string[] = []): PermissionSnapshot {
  return {
    platformRoles: new Set(),
    organizationRoles: new Map(),
    projectRoles: new Map(),
    agentRoles: new Map(
      agentIds.map((agentId) => [agentId, new Set(["agent_editor"])]),
    ),
  };
}

function returnAgents(agents: readonly StudioAgent[]): void {
  mockStudioAgentsQuery.mockReturnValue({
    data: { agents, total: agents.length, hasNext: false },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOrganizationQuery.mockReturnValue({ data: { id: 7 } });
  mockPermissionSnapshotQuery.mockReturnValue({ data: makePermissions() });
  mockUser.mockReturnValue({ id: 1, username: "me", email: "me@sico.dev" });
});

describe("<Studio>", () => {
  it("renders URL-backed links and Create in the shared tab row", () => {
    returnAgents([]);

    render(<Studio activeTab="all" />);

    const tabs = screen.getByRole("tablist");
    const create = screen.getByRole("button", { name: "Create" });
    const tabRow = tabs.parentElement?.parentElement;
    expect(tabRow).toContainElement(create);
    expect(tabRow).toHaveClass("flex-wrap", "gap-4", "px-5", "lg:px-16");
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/studio/all",
    );
    expect(screen.getByRole("link", { name: "Created" })).toHaveAttribute(
      "href",
      "/studio/created",
    );
    expect(screen.getByRole("link", { name: "Editable" })).toHaveAttribute(
      "href",
      "/studio/editable",
    );
  });

  it("shows only the current user's agents on the Created tab", () => {
    returnAgents([
      makeAgent({ name: "Mine", creatorUsername: "me" }),
      makeAgent({
        agentId: "00000000-0000-4000-8000-000000000002",
        name: "Theirs",
        creatorUsername: "other",
      }),
    ]);

    render(<Studio activeTab="created" />);

    screen.getByRole("link", { name: "Open Mine's setup" });
    expect(
      screen.queryByRole("link", { name: "Open Theirs's setup" }),
    ).not.toBeInTheDocument();
  });

  it("shows UUID-granted agents on the Editable tab", () => {
    const editable = makeAgent({
      agentId: "00000000-0000-4000-8000-000000000002",
      name: "Shared",
      creatorUsername: "other",
    });
    mockPermissionSnapshotQuery.mockReturnValue({
      data: makePermissions([editable.agentId]),
    });
    returnAgents([editable]);

    render(<Studio activeTab="editable" />);

    screen.getByRole("link", { name: "Open Shared's setup" });
  });

  it("renders each agent's creator without publication status copy", () => {
    returnAgents([
      makeAgent({
        creatorUsername: "creator@sico.dev",
        publishStatus: SingleAgentPublishStatusSchema.enum.PUBLISHED,
      }),
    ]);

    render(<Studio activeTab="all" />);

    screen.getByText("creator@sico.dev");
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("renders an empty state for a tab with no matching agents", () => {
    returnAgents([makeAgent({ creatorUsername: "other" })]);

    render(<Studio activeTab="created" />);

    screen.getByRole("heading", { name: "No digital workers yet" });
  });

  it("keeps the Studio header visible when a tab query fails", () => {
    mockStudioAgentsQuery.mockImplementation(() => {
      throw new Error("list failed");
    });

    render(<Studio activeTab="all" />);

    screen.getByRole("heading", { name: "Studio" });
    screen.getByRole("button", { name: "Try again" });
  });
});
