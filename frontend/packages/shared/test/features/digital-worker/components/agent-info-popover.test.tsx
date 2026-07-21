import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentInfoPopover } from "@/features/digital-worker/components/agent-info-popover";
import { type Agent } from "@/features/digital-worker/schemas/agent";

// operatorUsername (the assigned operator) and employerUsername (the owner) are
// DISTINCT backend fields; the fixture sets them apart so a test can prove the
// "Operator" row reads the former, not the latter (the migration bug).
const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 1,
  name: "MAXweb",
  role: "Tester",
  operatorUsername: "operator-alice",
  employerUsername: "owner-bob",
  project: { id: 2, name: "Demo" },
  ...overrides,
});

describe("<AgentInfoPopover>", () => {
  it("shows the operator's username in the Operator row", () => {
    render(<AgentInfoPopover agent={makeAgent()} />);
    expect(screen.getByText("operator-alice")).toBeInTheDocument();
  });

  it("does not show the employer's username as the Operator", () => {
    render(<AgentInfoPopover agent={makeAgent()} />);
    expect(screen.queryByText("owner-bob")).not.toBeInTheDocument();
  });

  it("omits the Operator row when operatorUsername is absent", () => {
    render(
      <AgentInfoPopover agent={makeAgent({ operatorUsername: undefined })} />,
    );
    expect(screen.queryByText("Operator")).not.toBeInTheDocument();
  });

  it("shows the project name in the Project row", () => {
    render(<AgentInfoPopover agent={makeAgent()} />);
    expect(screen.getByText("Demo")).toBeInTheDocument();
  });
});
