import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolCallSubTaskSummary } from "@/features/chat/components/cards/plan-card/tool-call-subtask-summary";

describe("ToolCallSubTaskSummary", () => {
  it("renders the passed roll-up as '{passed}/{total} passed.'", () => {
    render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={2} total={6} />,
    );
    expect(screen.getByText("3/6 passed.")).toBeInTheDocument();
  });

  it("renders the failed roll-up as '{failed}/{total} failed.'", () => {
    render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={2} total={6} />,
    );
    expect(screen.getByText("1/6 failed.")).toBeInTheDocument();
  });

  it("renders the pending roll-up as '{pending}/{total} pending.' when pending > 0", () => {
    render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={2} total={6} />,
    );
    expect(screen.getByText("2/6 pending.")).toBeInTheDocument();
  });

  it("omits the pending roll-up entirely when pending is 0", () => {
    render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={0} total={4} />,
    );
    expect(screen.queryByText(/pending\./)).not.toBeInTheDocument();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(
      <ToolCallSubTaskSummary passed={3} failed={1} pending={2} total={6} />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
