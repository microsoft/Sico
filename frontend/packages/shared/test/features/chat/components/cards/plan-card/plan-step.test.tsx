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

import { PlanStep } from "@/features/chat/components/cards/plan-card/plan-step";
import type {
  PlanStep as PlanStepModel,
  ToolCall,
} from "@/features/chat/schemas/plan";
import {
  PlanStepStatusSchema,
  ToolCallStatusSchema,
} from "@/features/chat/schemas/plan";

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: `tc-${Math.random()}`,
    toolName: "read_file",
    status: ToolCallStatusSchema.enum.SUCCESSFUL,
    subCalls: [],
    ...overrides,
  };
}

function step(overrides: Partial<PlanStepModel> = {}): PlanStepModel {
  return {
    id: "0",
    title: "Generate Task Execution Plan",
    status: PlanStepStatusSchema.enum.COMPLETED,
    toolCalls: [],
    ...overrides,
  };
}

describe("PlanStep", () => {
  it("renders the step title", () => {
    render(<PlanStep step={step({ title: "Enrich Test Cases" })} />);
    expect(screen.getByText("Enrich Test Cases")).toBeInTheDocument();
  });

  it("shows a spinner glyph for an IN_PROGRESS step", () => {
    const { container } = render(
      <PlanStep
        step={step({ status: PlanStepStatusSchema.enum.IN_PROGRESS })}
      />,
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows the error status dot for a FAILED step", () => {
    const { container } = render(
      <PlanStep step={step({ status: PlanStepStatusSchema.enum.FAILED })} />,
    );
    expect(
      container.querySelector(".bg-status-error-foreground"),
    ).toBeInTheDocument();
  });

  it("shows a muted status dot for a COMPLETED step", () => {
    const { container } = render(
      <PlanStep step={step({ status: PlanStepStatusSchema.enum.COMPLETED })} />,
    );
    expect(container.querySelector(".bg-icon-secondary")).toBeInTheDocument();
  });

  it("places the dot in the shared w-4 rail column (aligns with the header icon)", () => {
    // The rail column is a fixed 16px (`w-4`) lane shared by the header icon and
    // every step dot, so `items-center` lands them all on the same vertical axis.
    const { container } = render(<PlanStep step={step()} isLastStep={false} />);
    expect(container.querySelector(".w-4.flex-col")).toBeInTheDocument();
  });

  it("renders the descending connector below a non-last step's dot", () => {
    // The continuous timeline: a `flex-1` border segment drops from the dot to
    // the next step. Present only when the step is not the last.
    const { container } = render(<PlanStep step={step()} isLastStep={false} />);
    expect(container.querySelector(".border-l.flex-1")).toBeInTheDocument();
  });

  it("omits the descending connector below the last step's dot", () => {
    const { container } = render(<PlanStep step={step()} isLastStep />);
    expect(container.querySelector(".border-l.flex-1")).not.toBeInTheDocument();
  });

  it("draws the ascending segment above a non-first step's dot", () => {
    // A step with a neighbour above shows the upper guide segment so the
    // timeline reads as continuous into the dot.
    const { container } = render(
      <PlanStep step={step()} isFirstStep={false} isLastStep={false} />,
    );
    // Upper + lower halves both bordered, plus the flex-1 connector → 3 segments.
    expect(container.querySelectorAll(".border-l")).toHaveLength(3);
  });

  it("renders a bare dot with no guide line for a lone step", () => {
    // A single step is both first and last — no neighbour either side, so the
    // rail shows just the dot with no border-l segment at all.
    const { container } = render(
      <PlanStep step={step()} isFirstStep isLastStep />,
    );
    expect(container.querySelector(".border-l")).not.toBeInTheDocument();
  });

  it("renders a ToolMessage for each tool call's message", () => {
    render(
      <PlanStep
        step={step({
          toolCalls: [toolCall({ message: "Reading knowledge file" })],
        })}
      />,
    );
    expect(screen.getByText("Reading knowledge file")).toBeInTheDocument();
  });

  it("hides the message of a run_tasks fan-out tool call", () => {
    render(
      <PlanStep
        step={step({
          toolCalls: [
            toolCall({
              message: "should be hidden",
              executionInfo: { builtinToolName: "run_tasks" },
            }),
          ],
        })}
      />,
    );
    expect(screen.queryByText("should be hidden")).not.toBeInTheDocument();
  });

  it("renders the nested sub-call list under a tool call", () => {
    render(
      <PlanStep
        step={step({
          toolCalls: [
            toolCall({ subCalls: [toolCall({ toolName: "nested_probe" })] }),
          ],
        })}
      />,
    );
    expect(screen.getByText("nested_probe")).toBeInTheDocument();
  });

  it("rolls sub-calls up into a passed/failed/pending summary", () => {
    render(
      <PlanStep
        step={step({
          toolCalls: [
            toolCall({
              subCalls: [
                toolCall({ status: ToolCallStatusSchema.enum.SUCCESSFUL }),
                toolCall({ status: ToolCallStatusSchema.enum.FAILED }),
                toolCall({ status: ToolCallStatusSchema.enum.RUNNING }),
              ],
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("1/3 passed.")).toBeInTheDocument();
    expect(screen.getByText("1/3 failed.")).toBeInTheDocument();
    expect(screen.getByText("1/3 pending.")).toBeInTheDocument();
  });

  it("renders no summary when no tool call fanned out", () => {
    render(
      <PlanStep step={step({ toolCalls: [toolCall({ subCalls: [] })] })} />,
    );
    expect(screen.queryByText(/passed\./)).not.toBeInTheDocument();
  });

  it("renders the failure-analyzed note for a FAILED_ANALYZED tool call", () => {
    render(
      <PlanStep
        step={step({
          toolCalls: [
            toolCall({ status: ToolCallStatusSchema.enum.FAILED_ANALYZED }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Failure Analyzed.")).toBeInTheDocument();
  });

  it("renders the retry-success note for a RETRY_SUCCESSFUL tool call", () => {
    render(
      <PlanStep
        step={step({
          toolCalls: [
            toolCall({ status: ToolCallStatusSchema.enum.RETRY_SUCCESSFUL }),
          ],
        })}
      />,
    );
    expect(
      screen.getByText("Analysis Verified. New experience saved."),
    ).toBeInTheDocument();
  });

  it("renders deliverable chips for a tool call's deliverables", () => {
    render(
      <PlanStep
        step={step({
          toolCalls: [
            toolCall({ deliverables: [{ type: 2, fileName: "report.pdf" }] }),
          ],
        })}
      />,
    );
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(
      <PlanStep
        step={step({
          status: PlanStepStatusSchema.enum.FAILED,
          toolCalls: [
            toolCall({
              message: "Reading file",
              status: ToolCallStatusSchema.enum.FAILED_ANALYZED,
              subCalls: [
                toolCall({ status: ToolCallStatusSchema.enum.RUNNING }),
              ],
              deliverables: [{ type: 3, webPreviewSasUrl: "https://x/p" }],
            }),
          ],
        })}
        isLastStep={false}
      />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
