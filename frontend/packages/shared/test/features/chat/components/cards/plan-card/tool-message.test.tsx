import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolMessage } from "@/features/chat/components/cards/plan-card/tool-message";
import type { ToolCall } from "@/features/chat/schemas/plan";
import { ToolCallStatusSchema } from "@/features/chat/schemas/plan";

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: "tc-1",
    toolName: "read_file",
    message: "Reading knowledge file from project",
    status: ToolCallStatusSchema.enum.SUCCESSFUL,
    subCalls: [],
    ...overrides,
  };
}

describe("ToolMessage", () => {
  it("renders the tool call's message", () => {
    render(<ToolMessage toolCall={toolCall()} />);
    expect(
      screen.getByText("Reading knowledge file from project"),
    ).toBeInTheDocument();
  });

  it("renders nothing when the message is absent", () => {
    const { container } = render(
      <ToolMessage toolCall={toolCall({ message: undefined })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden when builtinToolName is run_tasks (§5)", () => {
    const { container } = render(
      <ToolMessage
        toolCall={toolCall({ executionInfo: { builtinToolName: "run_tasks" } })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders for any other builtin tool", () => {
    render(
      <ToolMessage
        toolCall={toolCall({
          executionInfo: { builtinToolName: "read_knowledge" },
        })}
      />,
    );
    expect(
      screen.getByText("Reading knowledge file from project"),
    ).toBeInTheDocument();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(<ToolMessage toolCall={toolCall()} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
