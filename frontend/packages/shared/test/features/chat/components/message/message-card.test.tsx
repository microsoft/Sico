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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { plansAtom } from "@/features/chat/atoms/chat-atom";
import type { Message } from "@/features/chat/atoms/chat-atom";
import { MessageCard } from "@/features/chat/components/message/message-card";
import type { Plan } from "@/features/chat/schemas/plan";
import { PlanStatusSchema } from "@/features/chat/schemas/plan";
import { ChatAgentProvider } from "@/features/chat/services/chat-agent-context";
import { formatDateTime } from "@/features/chat/utils/format-date-time";
import type { Agent } from "@/features/digital-worker";
import { ApiClientProvider } from "@/services/api-client-context";

// Spy injected into the AgentCard stub: counts how many times the AI text row
// renders, so the memo-bailout test can prove a completed row stays put while a
// sibling streams.
const agentRenderSpy = vi.fn();

// ExperiencePill (a turn-level sibling) calls `useNavigate` for its `View more`
// jump; this suite renders MessageCard outside a RouterProvider, so stub the
// router hook to keep the tree mountable and the output warning-free.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Stub the three routed `cards/` renderers so this test exercises the router's
// dispatch + the row memo in isolation — not the cards' own internals (those
// have their own suites). Each stub prints a probe its assertions can target.
vi.mock("@/features/chat/components/cards/user-card", () => ({
  UserCard: ({ text }: { text: string }): ReactElement => (
    <div data-testid="user-card">{text}</div>
  ),
}));
vi.mock("@/features/chat/components/cards/agent-card", () => ({
  AgentCard: ({
    text,
    streaming,
  }: {
    text: string;
    streaming?: boolean;
  }): ReactElement => {
    agentRenderSpy();
    return (
      <div
        data-testid="agent-card"
        data-streaming={streaming ? "true" : "false"}
      >
        {text}
      </div>
    );
  },
}));
vi.mock("@/features/chat/components/cards/plan-card", () => ({
  PlanCard: ({ planId }: { planId: string }): ReactElement => (
    <div data-testid="plan-card">{planId}</div>
  ),
}));

// ExperiencePill (a turn-level sibling) reads the live agent for its owning
// projectId and calls `useNavigate` for `View more`. This suite renders
// MessageCard outside a RouterProvider, so stub the router hook, and wrap with
// the chat providers (seeded agent) so the pill mounts warning-free.
const STORY_AGENT_ID = 601;
const seededAgent: Agent = {
  id: STORY_AGENT_ID,
  name: "Max",
  project: { id: 84, name: "SICO" },
};

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["agents", "detail", STORY_AGENT_ID], seededAgent);

  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <JotaiProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={{} as AxiosInstance}>
            <ChatAgentProvider
              agentInstanceId={STORY_AGENT_ID}
              conversationId={1}
            >
              {children}
            </ChatAgentProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </JotaiProvider>
    );
  }

  return Wrapper;
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    planId: "7",
    status: PlanStatusSchema.enum.RUNNING,
    steps: [],
    ...overrides,
  };
}

function seed(p?: Plan): ReturnType<typeof createStore> {
  const store = createStore();
  if (p) {
    store.set(plansAtom, new Map([[p.planId, p]]));
  }
  return store;
}

const human = (text: string): Message => ({
  id: "h1",
  author: "human",
  content: [{ partId: "hp1", type: "text", text }],
});

const aiText = (text: string, streaming = false): Message => ({
  id: "a1",
  author: "ai",
  streamingState: streaming ? "streaming" : "done",
  content: [{ partId: "ap1", type: "text", text }],
});

describe("MessageCard", () => {
  it("routes a human text part to UserCard", () => {
    render(<MessageCard message={human("ping")} />, {
      wrapper: withStore(seed()),
    });
    expect(screen.getByTestId("user-card")).toHaveTextContent("ping");
    expect(screen.queryByTestId("agent-card")).not.toBeInTheDocument();
  });

  it("routes an AI text part to AgentCard", () => {
    render(<MessageCard message={aiText("pong")} />, {
      wrapper: withStore(seed()),
    });
    expect(screen.getByTestId("agent-card")).toHaveTextContent("pong");
    expect(screen.queryByTestId("user-card")).not.toBeInTheDocument();
  });

  it("routes a plan part to PlanCard keyed on its planId", () => {
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [{ partId: "pp1", type: "plan", planId: "7" }],
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(
        seed(plan({ status: PlanStatusSchema.enum.COMPLETED })),
      ),
    });
    expect(screen.getByTestId("plan-card")).toHaveTextContent("7");
  });

  it("joins multiple text parts into one AgentCard body (not one card per part)", () => {
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [
        { partId: "ap1", type: "text", text: "first" },
        { partId: "ap2", type: "text", text: " second" },
      ],
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(seed()),
    });
    const cards = screen.getAllByTestId("agent-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("first second");
  });

  it("renders the PlanCard above the AgentCard text body (plan on top, sortList)", () => {
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [
        { partId: "ap1", type: "text", text: "summary text" },
        { partId: "pp1", type: "plan", planId: "7" },
      ],
    };
    const { container } = render(<MessageCard message={message} />, {
      wrapper: withStore(
        seed(plan({ status: PlanStatusSchema.enum.COMPLETED })),
      ),
    });
    const html = container.innerHTML;
    expect(html.indexOf('data-testid="plan-card"')).toBeLessThan(
      html.indexOf('data-testid="agent-card"'),
    );
  });

  it("spaces the text body off a PlanCard via the root gap, not an extra margin", () => {
    // Redesign (Figma 18991-47827): every turn-level part is spaced a uniform
    // 16px by the root `gap-4`, so the agent text needs no per-part top margin —
    // even when it follows a PlanCard. The body is no longer wrapped in an
    // mt-2 div.
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [
        { partId: "ap1", type: "text", text: "summary text" },
        { partId: "pp1", type: "plan", planId: "7" },
      ],
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(
        seed(plan({ status: PlanStatusSchema.enum.COMPLETED })),
      ),
    });
    expect(screen.getByTestId("agent-card").parentElement).not.toHaveClass(
      "mt-2",
    );
  });

  it("spaces every turn-level part by the root gap-4 (uniform 16px)", () => {
    const { container } = render(
      <MessageCard message={aiText("just text")} />,
      {
        wrapper: withStore(seed()),
      },
    );
    expect(container.firstChild).toHaveClass("gap-4");
  });

  it("renders the Timestamp sibling AFTER the routed parts, not as a part", () => {
    const createdAt = new Date("2026-06-12T15:32:00").getTime();
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [{ partId: "ap1", type: "text", text: "body" }],
      createdAt,
    };
    const { container } = render(<MessageCard message={message} />, {
      wrapper: withStore(seed()),
    });
    const time = screen.getByText(formatDateTime(createdAt));
    expect(time.tagName).toBe("TIME");
    // Sibling order: the timestamp follows the body card in the DOM.
    const html = container.innerHTML;
    expect(html.indexOf('data-testid="agent-card"')).toBeLessThan(
      html.indexOf("<time"),
    );
  });

  it("hides the Timestamp while the AI turn is still streaming", () => {
    const createdAt = new Date("2026-06-12T15:32:00").getTime();
    const message: Message = {
      ...aiText("partial", true),
      createdAt,
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(seed()),
    });
    expect(
      screen.queryByText(formatDateTime(createdAt)),
    ).not.toBeInTheDocument();
  });

  it("renders the message-level AttachmentList for a sent bubble's attachments", () => {
    const message: Message = {
      id: "h1",
      author: "human",
      content: [{ partId: "hp1", type: "text", text: "see file" }],
      attachments: [
        {
          id: "att1",
          name: "report.pdf",
          size: 2048,
          type: "application/pdf",
          uri: "https://x/report.pdf",
        },
      ],
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(seed()),
    });
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("shows the ReceivingIndicator while a streaming turn has no part yet", () => {
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "streaming",
      content: [],
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(seed()),
    });
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  it("shows a spinner during the pending window (placeholder created on click, before onopen)", () => {
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "pending",
      content: [],
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(seed()),
    });
    expect(
      screen.getByRole("status", { name: /loading/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });

  it("threads the turn's experienceCount to the ExperiencePill (Experience + N)", () => {
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [{ partId: "pp1", type: "plan", planId: "7" }],
      experienceCount: 2,
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(
        seed(plan({ status: PlanStatusSchema.enum.COMPLETED })),
      ),
    });
    expect(screen.getByText("Experience + 2")).toBeInTheDocument();
    expect(screen.queryByText("Generating experience")).not.toBeInTheDocument();
  });

  it("renders the ExperiencePill on a turn with experience but NO plan", () => {
    // Decoupled from the plan (mirrors legacy's `section.status === Done` gate,
    // not the plan's presence): a turn that carries an experience count but no
    // plan part still shows `Experience + N`. Before decoupling, the pill sat
    // inside `{planId && ...}` and a plan-less turn dropped it.
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [{ partId: "ap1", type: "text", text: "done, no plan" }],
      experienceCount: 4,
    };
    render(<MessageCard message={message} />, { wrapper: withStore(seed()) });
    expect(screen.getByText("Experience + 4")).toBeInTheDocument();
  });

  it("spaces the ExperiencePill via the root gap-4, not a per-part margin", () => {
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [{ partId: "pp1", type: "plan", planId: "7" }],
      experienceCount: 2,
    };
    render(<MessageCard message={message} />, {
      wrapper: withStore(
        seed(plan({ status: PlanStatusSchema.enum.COMPLETED })),
      ),
    });
    expect(screen.getByText("Experience + 2")).not.toHaveClass("mt-2");
  });

  it("spaces the Timestamp via the root gap-4, not a per-part margin", () => {
    const createdAt = new Date("2026-06-12T15:32:00").getTime();
    const message: Message = {
      id: "a1",
      author: "ai",
      streamingState: "done",
      content: [{ partId: "ap1", type: "text", text: "body" }],
      createdAt,
    };
    render(<MessageCard message={message} />, { wrapper: withStore(seed()) });
    expect(screen.getByText(formatDateTime(createdAt))).not.toHaveClass("mt-2");
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(<MessageCard message={aiText("hi")} />, {
      wrapper: withStore(seed()),
    });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("is memoized on message identity — a stable row does not re-render when a sibling streams", () => {
    // Two AI rows under one parent. The first row's `message` reference is held
    // stable (immer structural sharing for a settled turn); only the streaming
    // tail's reference changes between renders. A `React.memo` on message
    // identity must let the settled row bail out.
    const settled = aiText("settled body");

    function Harness({ tailText }: { tailText: string }): ReactElement {
      return (
        <>
          <MessageCard message={settled} />
          <MessageCard message={aiText(tailText, true)} />
        </>
      );
    }

    const { rerender } = render(<Harness tailText="one" />, {
      wrapper: withStore(seed()),
    });
    const afterFirst = agentRenderSpy.mock.calls.length;

    rerender(<Harness tailText="one two" />);
    const afterSecond = agentRenderSpy.mock.calls.length;

    // The settled row bailed out; only the tail row re-rendered → exactly one
    // additional AgentCard render, not two.
    expect(afterSecond - afterFirst).toBe(1);
  });
});
