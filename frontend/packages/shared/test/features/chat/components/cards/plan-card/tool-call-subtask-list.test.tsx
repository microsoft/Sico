import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ToolCallSubTaskList } from "@/features/chat/components/cards/plan-card/tool-call-subtask-list";
import type { ToolCall } from "@/features/chat/schemas/plan";
import { ToolCallStatusSchema } from "@/features/chat/schemas/plan";

function call(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: `tc-${Math.random()}`,
    toolName: "read_file",
    status: ToolCallStatusSchema.enum.SUCCESSFUL,
    subCalls: [],
    ...overrides,
  };
}

describe("ToolCallSubTaskList", () => {
  it("renders each sub-call's toolName", () => {
    render(
      <ToolCallSubTaskList
        subCalls={[
          call({ toolCallId: "a", toolName: "alpha" }),
          call({ toolCallId: "b", toolName: "beta" }),
        ]}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("status-sorts running before successful before failed", () => {
    render(
      <ToolCallSubTaskList
        subCalls={[
          call({
            toolCallId: "s",
            toolName: "alpha",
            status: ToolCallStatusSchema.enum.SUCCESSFUL,
          }),
          call({
            toolCallId: "r",
            toolName: "beta",
            status: ToolCallStatusSchema.enum.RUNNING,
          }),
          call({
            toolCallId: "f",
            toolName: "gamma",
            status: ToolCallStatusSchema.enum.FAILED,
          }),
        ]}
      />,
    );
    const rows = screen.getAllByText(/^(alpha|beta|gamma)$/);
    expect(rows.map((r) => r.textContent)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("shows only 3 rows plus a 'Show more' toggle when there are more than 3", () => {
    render(
      <ToolCallSubTaskList
        subCalls={Array.from({ length: 8 }, (_, i) =>
          call({ toolCallId: `t${i}`, toolName: `tool-${i}` }),
        )}
      />,
    );
    expect(screen.getByText("tool-0")).toBeInTheDocument();
    expect(screen.getByText("tool-2")).toBeInTheDocument();
    expect(screen.queryByText("tool-3")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show more/i }),
    ).toBeInTheDocument();
  });

  it("toggles between Show more and Show less, revealing then re-hiding the overflow", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallSubTaskList
        subCalls={Array.from({ length: 8 }, (_, i) =>
          call({ toolCallId: `t${i}`, toolName: `tool-${i}` }),
        )}
      />,
    );
    // Expand: every row shows, button flips to Show less.
    await user.click(screen.getByRole("button", { name: /show more/i }));
    expect(screen.getByText("tool-3")).toBeInTheDocument();
    expect(screen.getByText("tool-7")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show less/i }),
    ).toBeInTheDocument();

    // Collapse: the overflow hides again, button flips back to Show more.
    await user.click(screen.getByRole("button", { name: /show less/i }));
    expect(screen.queryByText("tool-3")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show more/i }),
    ).toBeInTheDocument();
  });

  it("renders no toggle when there are 3 or fewer rows", () => {
    render(
      <ToolCallSubTaskList
        subCalls={Array.from({ length: 3 }, (_, i) =>
          call({ toolCallId: `t${i}`, toolName: `tool-${i}` }),
        )}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no sub-calls", () => {
    const { container } = render(<ToolCallSubTaskList subCalls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(
      <ToolCallSubTaskList
        subCalls={[
          call({ status: ToolCallStatusSchema.enum.RUNNING }),
          call({ status: ToolCallStatusSchema.enum.FAILED }),
          call({ status: ToolCallStatusSchema.enum.PENDING }),
        ]}
      />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
