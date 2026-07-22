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

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";

import {
  activeConversationIdAtom,
  type Conversation,
  conversationsAtom,
  type Message,
  plansAtom,
} from "@/features/chat/atoms/chat-atom";
import { PlanCard } from "@/features/chat/components/cards/plan-card";
import {
  type Plan,
  PlanStatusSchema,
  PlanStepStatusSchema,
  type ToolCall,
  ToolCallStatusSchema,
} from "@/features/chat/schemas/plan";
import { ChatAgentProvider } from "@/features/chat/services/chat-agent-context";
import { ApiClientProvider } from "@/services/api-client-context";

// PlanCard reads its tree from `plansAtom` and mounts `usePlan` (a 2 s poll).
// These stories pre-seed the store and mark the turn terminal so the poll
// self-suppresses at mount (use-plan.ts:147) — no network, no apiClient calls.
// The fake apiClient below only satisfies `useApiClient()`; it is never invoked.
const idleApiClient = {
  get: () => new Promise(() => {}),
  post: () => new Promise(() => {}),
} as unknown as AxiosInstance;

const AGENT_ID = 1;
const TURN_ID = 42;
const PLAN_ID = String(TURN_ID);

// A done AI message carrying this turn's plan Part → `isTurnTerminal` is true →
// `usePlan` returns before starting the interval (no poll in Storybook).
function terminalConversation(): Conversation {
  const aiMessage: Message = {
    id: "ai-1",
    author: "ai",
    streamingState: "done",
    content: [{ partId: "p1", type: "plan", planId: PLAN_ID }],
    turnId: TURN_ID,
  };
  return { clientId: "story", history: [aiMessage] };
}

function tool(
  id: string,
  toolName: string,
  status: ToolCall["status"],
  extra: Partial<ToolCall> = {},
): ToolCall {
  return { toolCallId: id, toolName, status, subCalls: [], ...extra };
}

// Build a Plan fixture mirroring the Figma 15156-42470 step content.
function makePlan(status: Plan["status"], steps: Plan["steps"]): Plan {
  return { planId: PLAN_ID, status, title: "Plan", steps };
}

// Hand-authored plan trees mirroring the Figma step content, one per terminal
// status. Kept inline (no captured fixture) so the stories own their data.
const completedSteps: Plan["steps"] = [
  {
    id: "0",
    title: "Load relevant skill instructions",
    status: PlanStepStatusSchema.enum.COMPLETED,
    toolCalls: [
      tool("0", "Context", ToolCallStatusSchema.enum.SUCCESSFUL, {
        message: "Fetched workspace files and metadata",
        executionInfo: { builtinToolName: "context" },
      }),
      tool("1", "Read", ToolCallStatusSchema.enum.SUCCESSFUL, {
        message: "Read file skills/62/SKILL.md, line 0 to 107.",
        executionInfo: { builtinToolName: "read" },
      }),
    ],
  },
  {
    id: "1",
    title: "Draft focused normal-flow test cases",
    status: PlanStepStatusSchema.enum.COMPLETED,
    toolCalls: [],
  },
];

const failedSteps: Plan["steps"] = [
  {
    id: "0",
    title: "Load workspace context and locate skill instructions",
    status: PlanStepStatusSchema.enum.COMPLETED,
    toolCalls: [
      tool("0", "Context", ToolCallStatusSchema.enum.SUCCESSFUL, {
        message: "Fetched workspace files and metadata",
        executionInfo: { builtinToolName: "context" },
      }),
    ],
  },
  {
    id: "1",
    title: "Acquire suitable sandbox for Windows Edge testing",
    status: PlanStepStatusSchema.enum.FAILED,
    toolCalls: [
      tool("0", "Sandbox Acquire", ToolCallStatusSchema.enum.SUCCESSFUL, {
        message:
          "No assigned wincua sandbox is currently available for acquire.",
        executionInfo: { builtinToolName: "sandbox_acquire" },
      }),
    ],
  },
];

const stoppedSteps: Plan["steps"] = [
  {
    id: "0",
    title: "Acquire Windows sandbox for web testing",
    status: PlanStepStatusSchema.enum.COMPLETED,
    toolCalls: [
      tool("0", "Sandbox Acquire", ToolCallStatusSchema.enum.SUCCESSFUL, {
        message: "Acquired 1 wincua sandbox(s).",
        executionInfo: { builtinToolName: "sandbox_acquire" },
        // A captured deliverable so the card renders its file tile.
        deliverables: [
          {
            type: 2,
            fileName: "Windows-Device #6",
          },
        ],
      }),
    ],
  },
  {
    id: "1",
    title: "Run web test case for Bing Images Header",
    status: PlanStepStatusSchema.enum.CANCELLED,
    toolCalls: [],
  },
];

const inProgressSteps: Plan["steps"] = [
  {
    id: "0",
    title: "Generate Task Execution Plan",
    status: PlanStepStatusSchema.enum.COMPLETED,
    toolCalls: [
      tool("t0", "plan_write", ToolCallStatusSchema.enum.SUCCESSFUL, {
        message: "Reading knowledge file from project",
      }),
    ],
  },
  {
    id: "1",
    title: "Enrich Test Cases",
    status: PlanStepStatusSchema.enum.IN_PROGRESS,
    toolCalls: [
      tool("t1", "fan_out", ToolCallStatusSchema.enum.RUNNING, {
        message: "Retrieved 60 Android test cases from Project Knowledge",
        subCalls: [
          tool(
            "s1",
            "Login attempt with expired session token",
            ToolCallStatusSchema.enum.RUNNING,
          ),
          tool(
            "s2",
            "Password reset flow — email delivery",
            ToolCallStatusSchema.enum.PENDING,
          ),
          tool(
            "s3",
            "Auth callback handles state mismatch",
            ToolCallStatusSchema.enum.PENDING,
          ),
          tool(
            "s4",
            "Device status transitions on job assign",
            ToolCallStatusSchema.enum.PENDING,
          ),
        ],
      }),
    ],
  },
];

type StoryArgs = { status: Plan["status"]; steps: Plan["steps"] };

// Each story seeds its own store so they stay isolated on the Docs page.
function withSeededStore(
  status: Plan["status"],
  steps: Plan["steps"],
): ReturnType<typeof createStore> {
  const store = createStore();
  store.set(conversationsAtom, new Map([["story", terminalConversation()]]));
  store.set(activeConversationIdAtom, "story");
  store.set(plansAtom, new Map([[PLAN_ID, makePlan(status, steps)]]));
  return store;
}

const meta: Meta<StoryArgs> = {
  title: "Chat/PlanCard",
  render: ({ status, steps }): ReactElement => (
    <Provider store={withSeededStore(status, steps)}>
      <ApiClientProvider client={idleApiClient}>
        <ChatAgentProvider agentInstanceId={AGENT_ID} conversationId={1}>
          {/* Page-surface stage so the card's (absent) chrome reads against the
              real app background, mirroring the conversation column width. */}
          <div className="bg-background max-w-190 p-4">
            <PlanCard planId={PLAN_ID} />
          </div>
        </ChatAgentProvider>
      </ApiClientProvider>
    </Provider>
  ),
  parameters: { docs: { source: { code: '<PlanCard planId="42" />' } } },
  args: { status: PlanStatusSchema.enum.COMPLETED, steps: completedSteps },
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** Completed plan — the default resting state seeds collapsed; click the header
 *  to expand the step rows (Figma 15184-42530). */
export const Completed: Story = {
  args: { status: PlanStatusSchema.enum.COMPLETED, steps: completedSteps },
};

/** In-progress plan — header carries the spinner; a fan-out step shows its
 *  passed/failed/pending roll-up + nested sub-tasks (Figma 15156-42470). Seeds
 *  expanded because the first observed status is RUNNING. */
export const InProgress: Story = {
  args: { status: PlanStatusSchema.enum.RUNNING, steps: inProgressSteps },
};

/** Failed plan — a step errored; `Execution failed` header, re-expand to read
 *  the failure rows (Figma 15157-10127). */
export const Failed: Story = {
  args: { status: PlanStatusSchema.enum.FAILED, steps: failedSteps },
};

/** Stopped plan — user pressed Stop; `Execution stopped` header. Real captured
 *  turn 28, which carries a sandbox deliverable (Figma 15157-10244). */
export const Stopped: Story = {
  args: { status: PlanStatusSchema.enum.CANCELLED, steps: stoppedSteps },
};

/** Single step — a lone step has no neighbour above or below, so the rail
 *  renders a bare dot with no guide line. */
export const SingleStep: Story = {
  args: {
    status: PlanStatusSchema.enum.COMPLETED,
    steps: [completedSteps[0]!],
  },
};
