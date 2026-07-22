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
import userEvent from "@testing-library/user-event";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { plansAtom } from "@/features/chat/atoms/chat-atom";
import { sidepaneContentAtom } from "@/features/chat/atoms/sidepane-atom";
import { PlanSummary } from "@/features/chat/components/message/plan-summary";
import type { Plan, PlanStep, ToolCall } from "@/features/chat/schemas/plan";
import {
  PlanStatusSchema,
  PlanStepStatusSchema,
  ToolCallStatusSchema,
} from "@/features/chat/schemas/plan";

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  }

  return Wrapper;
}

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: `tc-${Math.random()}`,
    toolName: "read_file",
    status: ToolCallStatusSchema.enum.SUCCESSFUL,
    subCalls: [],
    ...overrides,
  };
}

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: "0",
    title: "Generate report",
    status: PlanStepStatusSchema.enum.COMPLETED,
    toolCalls: [],
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    planId: "7",
    status: PlanStatusSchema.enum.COMPLETED,
    steps: [],
    ...overrides,
  };
}

// A tool call flagged as the backend `report` tool, carrying deliverables.
function reportTool(deliverables: unknown[]): ToolCall {
  return toolCall({
    toolName: "Generate Report",
    executionInfo: { builtinToolName: "report" },
    deliverables,
  });
}

function seed(p: Plan | undefined): ReturnType<typeof createStore> {
  const store = createStore();
  if (p) {
    store.set(plansAtom, new Map([[p.planId, p]]));
  }
  return store;
}

describe("PlanSummary", () => {
  it("renders a card per report-tool deliverable", () => {
    const store = seed(
      plan({
        steps: [
          step({
            toolCalls: [reportTool([{ type: 2, fileName: "result.pdf" }])],
          }),
        ],
      }),
    );
    render(<PlanSummary planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByText("result.pdf")).toBeInTheDocument();
  });

  it("matches on builtinToolName === 'report', not on toolName", () => {
    const store = seed(
      plan({
        steps: [
          // toolName looks like a report but carries no builtinToolName → ignored.
          step({
            id: "0",
            toolCalls: [
              toolCall({
                toolName: "report",
                deliverables: [{ type: 2, fileName: "decoy.pdf" }],
              }),
            ],
          }),
          // Backend-flagged report tool with a human-facing toolName → included.
          step({
            id: "1",
            toolCalls: [reportTool([{ type: 2, fileName: "real.pdf" }])],
          }),
        ],
      }),
    );
    render(<PlanSummary planId="7" />, { wrapper: withStore(store) });
    expect(screen.queryByText("decoy.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("real.pdf")).toBeInTheDocument();
  });

  it("flattens report deliverables across multiple steps", () => {
    const store = seed(
      plan({
        steps: [
          step({
            id: "0",
            toolCalls: [reportTool([{ type: 2, fileName: "a.pdf" }])],
          }),
          step({
            id: "1",
            toolCalls: [reportTool([{ type: 1, markdownTitle: "B Summary" }])],
          }),
        ],
      }),
    );
    render(<PlanSummary planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("B Summary")).toBeInTheDocument();
  });

  it("labels a web-preview deliverable 'Preview Page'", () => {
    const store = seed(
      plan({
        steps: [
          step({
            toolCalls: [
              reportTool([{ type: 3, webPreviewSasUrl: "https://x/p" }]),
            ],
          }),
        ],
      }),
    );
    render(<PlanSummary planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByText("Preview Page")).toBeInTheDocument();
  });

  it("renders null when no report tool exists yet (plan still running)", () => {
    const store = seed(
      plan({
        status: PlanStatusSchema.enum.RUNNING,
        steps: [
          step({
            toolCalls: [
              toolCall({ deliverables: [{ type: 2, fileName: "x.pdf" }] }),
            ],
          }),
        ],
      }),
    );
    const { container } = render(<PlanSummary planId="7" />, {
      wrapper: withStore(store),
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders null when the plan is absent", () => {
    const store = seed(undefined);
    const { container } = render(<PlanSummary planId="7" />, {
      wrapper: withStore(store),
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("never writes to the store during render (no effect write-back)", () => {
    const store = seed(
      plan({
        steps: [
          step({ toolCalls: [reportTool([{ type: 2, fileName: "r.pdf" }])] }),
        ],
      }),
    );
    const setSpy = vi.spyOn(store, "set");
    render(<PlanSummary planId="7" />, { wrapper: withStore(store) });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const store = seed(
      plan({
        steps: [
          step({
            toolCalls: [
              reportTool([
                { type: 2, fileName: "r.pdf" },
                { type: 3, webPreviewSasUrl: "https://x/p" },
              ]),
            ],
          }),
        ],
      }),
    );
    const { container } = render(<PlanSummary planId="7" />, {
      wrapper: withStore(store),
    });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  // --- click-to-open the sidepane (D1 un-park) -------------------------------

  it("opens webpage content in the sidepane when a preview card is clicked", async () => {
    const store = seed(
      plan({
        steps: [
          step({
            toolCalls: [
              reportTool([{ type: 3, webPreviewSasUrl: "https://x/p" }]),
            ],
          }),
        ],
      }),
    );
    const user = userEvent.setup();
    render(<PlanSummary planId="7" />, { wrapper: withStore(store) });
    await user.click(screen.getByRole("button", { name: /Preview Page/ }));
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "webpage",
      url: "https://x/p",
    });
  });

  it("opens file content in the sidepane when a file card is clicked", async () => {
    const store = seed(
      plan({
        steps: [
          step({ toolCalls: [reportTool([{ type: 2, fileName: "r.pdf" }])] }),
        ],
      }),
    );
    const user = userEvent.setup();
    render(<PlanSummary planId="7" />, { wrapper: withStore(store) });
    await user.click(screen.getByRole("button", { name: /r\.pdf/ }));
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "file",
      filename: "r.pdf",
      fileUrl: "",
      fileUri: "",
      canAddToProject: true,
    });
  });
});
