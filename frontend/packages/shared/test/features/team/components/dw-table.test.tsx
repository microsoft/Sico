import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  type Agent,
  AgentStatusSchema,
} from "@/features/digital-worker/schemas/agent";
import { DigitalWorkersTable } from "@/features/team/components/dw-table";

vi.mock("@/features/digital-worker/hooks/use-dismiss-agent-mutation", () => ({
  useDismissAgentMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

function makeAgent(partial: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: "Max",
    project: { id: 7, name: "SICO" },
    ...partial,
  } as Agent;
}

function renderTable(
  agents: Agent[],
  props: Partial<{
    canManageDw: boolean;
    canInviteDw: boolean;
    userEmail: string | null;
  }> = {},
): void {
  render(
    <DigitalWorkersTable
      agents={agents}
      canManageDw={props.canManageDw ?? false}
      canInviteDw={props.canInviteDw ?? false}
      userEmail={props.userEmail ?? null}
      onReassign={vi.fn()}
    />,
  );
}

describe("DigitalWorkersTable status column", () => {
  it("has a STATUS column, not SANDBOX", () => {
    renderTable([makeAgent()]);
    expect(
      screen.getByRole("columnheader", { name: "STATUS" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "SANDBOX" }),
    ).not.toBeInTheDocument();
  });

  it("shows an Active badge for an ACTIVE worker", () => {
    renderTable([makeAgent({ status: AgentStatusSchema.enum.ACTIVE })]);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows an Inactive badge for an INACTIVE worker", () => {
    renderTable([makeAgent({ status: AgentStatusSchema.enum.INACTIVE })]);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows an Inactive badge when the status is unset", () => {
    renderTable([makeAgent({ status: undefined })]);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });
});

describe("DigitalWorkersTable ordering", () => {
  it("sorts active workers ahead of inactive ones", () => {
    renderTable([
      makeAgent({
        id: 1,
        name: "Inactive One",
        status: AgentStatusSchema.enum.INACTIVE,
      }),
      makeAgent({
        id: 2,
        name: "Active One",
        status: AgentStatusSchema.enum.ACTIVE,
      }),
    ]);
    const names = screen
      .getAllByRole("cell", { name: /One/ })
      .map((cell) => cell.textContent);
    expect(names).toEqual(["Active One", "Inactive One"]);
  });

  it("keeps the backend order within each status group (stable sort)", () => {
    // Interleaved input: an unstable sort could reorder same-group members, so
    // asserting the within-group order (A1 before A2, I1 before I2) actually
    // exercises stability — not just the active-before-inactive split.
    renderTable([
      makeAgent({
        id: 1,
        name: "Active 1",
        status: AgentStatusSchema.enum.ACTIVE,
      }),
      makeAgent({
        id: 2,
        name: "Inactive 1",
        status: AgentStatusSchema.enum.INACTIVE,
      }),
      makeAgent({
        id: 3,
        name: "Active 2",
        status: AgentStatusSchema.enum.NEW,
      }),
      makeAgent({
        id: 4,
        name: "Inactive 2",
        status: AgentStatusSchema.enum.INACTIVE,
      }),
    ]);
    const names = screen
      .getAllByRole("cell", { name: /(Active|Inactive) \d/ })
      .map((cell) => cell.textContent);
    expect(names).toEqual(["Active 1", "Active 2", "Inactive 1", "Inactive 2"]);
  });
});

describe("DigitalWorkersTable LAST ACTIVE column", () => {
  it("renders an agent's own updatedAt", () => {
    // 1784540848000 = epoch MS → Jul 2026 (the agent contract sends ms).
    renderTable([makeAgent({ updatedAt: 1784540848000 })]);
    expect(screen.getByRole("cell", { name: /2026/ })).toBeInTheDocument();
  });

  it("leaves the cell blank when an agent has no updatedAt", () => {
    renderTable([makeAgent()]);
    // The 4th column (index 3: NAME, OPERATOR, STATUS, LAST ACTIVE) is empty.
    const cells = screen.getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("");
  });
});

describe("DigitalWorkersTable RBAC gating", () => {
  it("shows the actions menu for an admin (canManageDw)", () => {
    renderTable([makeAgent()], { canManageDw: true });
    expect(
      screen.getByRole("button", { name: "Digital Worker actions" }),
    ).toBeInTheDocument();
  });

  it("shows the actions menu for a member on a worker they invited", () => {
    renderTable([makeAgent({ employerUsername: "me@company.com" })], {
      canInviteDw: true,
      userEmail: "me@company.com",
    });
    expect(
      screen.getByRole("button", { name: "Digital Worker actions" }),
    ).toBeInTheDocument();
  });

  it("matches the inviter despite an email-casing difference", () => {
    renderTable([makeAgent({ employerUsername: "Me@Company.com" })], {
      canInviteDw: true,
      userEmail: "me@company.com",
    });
    expect(
      screen.getByRole("button", { name: "Digital Worker actions" }),
    ).toBeInTheDocument();
  });

  it("gates both menu items for a member on someone else's worker", async () => {
    const user = userEvent.setup();
    renderTable(
      [
        makeAgent({
          employerUsername: "other@company.com",
          status: AgentStatusSchema.enum.ACTIVE,
        }),
      ],
      {
        canInviteDw: true,
        userEmail: "me@company.com",
      },
    );
    // The trigger opens for everyone; the items inside are gated.
    await user.click(
      screen.getByRole("button", { name: "Digital Worker actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Reassign" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Dismiss" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("gates both menu items when the viewer has no capability", async () => {
    const user = userEvent.setup();
    renderTable([makeAgent({ status: AgentStatusSchema.enum.ACTIVE })]);
    await user.click(
      screen.getByRole("button", { name: "Digital Worker actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Reassign" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Dismiss" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("keeps the ACTIONS column even when no row is actionable", () => {
    renderTable([makeAgent({ employerUsername: "other@company.com" })], {
      canInviteDw: true,
      userEmail: "me@company.com",
    });
    expect(
      screen.getByRole("columnheader", { name: "ACTIONS" }),
    ).toBeInTheDocument();
  });

  it("keeps the ACTIONS column for an admin", () => {
    renderTable([makeAgent()], { canManageDw: true });
    expect(
      screen.getByRole("columnheader", { name: "ACTIONS" }),
    ).toBeInTheDocument();
  });
});

describe("DigitalWorkersTable inactive worker actions", () => {
  it("offers only Reassign (no Dismiss) for an inactive worker", async () => {
    const user = userEvent.setup();
    renderTable([makeAgent({ status: AgentStatusSchema.enum.INACTIVE })], {
      canManageDw: true,
    });
    await user.click(
      screen.getByRole("button", { name: "Digital Worker actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Reassign" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
  });

  it("keeps Dismiss for an active worker", async () => {
    const user = userEvent.setup();
    renderTable([makeAgent({ status: AgentStatusSchema.enum.ACTIVE })], {
      canManageDw: true,
    });
    await user.click(
      screen.getByRole("button", { name: "Digital Worker actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Dismiss" }),
    ).toBeInTheDocument();
  });
});
