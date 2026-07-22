/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
