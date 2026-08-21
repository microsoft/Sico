import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useDedupedAgents,
  useSuspenseAgentsInfiniteQuery,
} from "@/features/digital-worker/hooks/use-agents-query";
import { useDismissAgentMutation } from "@/features/digital-worker/hooks/use-dismiss-agent-mutation";
import { type Agent } from "@/features/digital-worker/schemas/agent";
import { deriveCapabilities } from "@/features/rbac/capabilities";
import { useProjectPermission } from "@/features/rbac/hooks/use-project-permission";
import { MembersDwTab } from "@/features/team/components/members-dw-tab";

vi.mock("@/features/rbac/hooks/use-project-permission", () => ({
  useProjectPermission: vi.fn(),
}));

vi.mock("@/features/digital-worker/hooks/use-agents-query", () => ({
  useSuspenseAgentsInfiniteQuery: vi.fn(),
  useDedupedAgents: vi.fn(),
}));

vi.mock("@/features/digital-worker/hooks/use-dismiss-agent-mutation", () => ({
  useDismissAgentMutation: vi.fn(),
}));

// The reassign dialog owns its own data + mutation wiring; stub it so this
// suite stays focused on the tab's RBAC gating.
vi.mock("@/features/team/components/reassign-dw-dialog", () => ({
  ReassignDwDialog: () => null,
}));

const mockedUseProjectPermission = vi.mocked(useProjectPermission);
const mockedUseAgentsQuery = vi.mocked(useSuspenseAgentsInfiniteQuery);
const mockedUseDedupedAgents = vi.mocked(useDedupedAgents);
const mockedUseDismiss = vi.mocked(useDismissAgentMutation);

function makeAgent(partial: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: "Max",
    project: { id: 7, name: "SICO" },
    ...partial,
  } as Agent;
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
  render(<MembersDwTab projectId={7} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseAgentsQuery.mockReturnValue({
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useSuspenseAgentsInfiniteQuery>);
  mockedUseDedupedAgents.mockReturnValue([makeAgent()]);
  mockedUseDismiss.mockReturnValue({
    mutate: vi.fn(),
  } as unknown as ReturnType<typeof useDismissAgentMutation>);
});

describe("MembersDwTab RBAC gating", () => {
  it("shows per-row actions for an admin", () => {
    setPermission(true);
    renderTab();

    expect(
      screen.getByRole("button", { name: "Digital Worker actions" }),
    ).toBeInTheDocument();
  });

  it("keeps the actions trigger reachable for a non-admin (items gated inside)", () => {
    setPermission(false);
    renderTab();

    // The `···` trigger opens for everyone; the per-item gating (greyed +
    // tooltip) is covered by the dw-table unit tests.
    const trigger = screen.getByRole("button", {
      name: "Digital Worker actions",
    });
    expect(trigger).not.toHaveAttribute("aria-disabled", "true");
    // The worker itself still renders.
    expect(screen.getByText("Max")).toBeInTheDocument();
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
      screen.getByRole("button", { name: "Digital Worker actions" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("drains remaining agent pages so later-page workers aren't dropped", () => {
    const fetchNextPage = vi.fn();
    mockedUseAgentsQuery.mockReturnValue({
      data: { pages: [] },
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    } as unknown as ReturnType<typeof useSuspenseAgentsInfiniteQuery>);
    setPermission(true);
    renderTab();

    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("scopes the agents query to this project and includes inactive workers", () => {
    setPermission(true);
    renderTab();

    expect(mockedUseAgentsQuery).toHaveBeenCalledWith({
      projectId: 7,
      showInactive: true,
    });
  });

  it("renders the empty state when the project has no digital workers", () => {
    setPermission(true);
    mockedUseDedupedAgents.mockReturnValue([]);
    renderTab();

    expect(screen.getByText("No digital workers yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "NAME" }),
    ).not.toBeInTheDocument();
  });

  it("appends loading-more rows while draining later agent pages", () => {
    setPermission(true);
    mockedUseAgentsQuery.mockReturnValue({
      data: { pages: [] },
      hasNextPage: true,
      isFetchingNextPage: true,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useSuspenseAgentsInfiniteQuery>);
    mockedUseDedupedAgents.mockReturnValue([makeAgent()]);
    renderTab();

    // The table stays mounted (the worker still renders) and trailing skeleton
    // rows are appended — not swapped for a full-table skeleton.
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("dw-table-loading-more-row").length,
    ).toBeGreaterThan(0);
  });
});
