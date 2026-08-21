import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { plansAtom } from "@/features/chat/atoms/chat-atom";
import { PlanCard } from "@/features/chat/components/cards/plan-card";
import type { Plan, PlanStep } from "@/features/chat/schemas/plan";
import {
  PlanStatusSchema,
  PlanStepStatusSchema,
} from "@/features/chat/schemas/plan";
import { ChatAgentProvider } from "@/features/chat/services/chat-agent-context";
import { fetchPlan } from "@/features/chat/services/plan";
import { ApiClientProvider } from "@/services/api-client-context";

// PlanCard now mounts its own `/plan` poll (`use-plan`), so it reads both the
// api client and the agent-id context. The network boundary is stubbed; the
// real `mergePlan` write path stays intact (only `fetchPlan` is mocked).
vi.mock("@/features/chat/services/plan", async (importActual) => {
  const actual =
    await importActual<typeof import("@/features/chat/services/plan")>();
  return { ...actual, fetchPlan: vi.fn() };
});

// The agent id every test mounts the card under (assertable on the poll call).
const AGENT_ID = 42;
const apiClient = {} as AxiosInstance;

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <JotaiProvider store={store}>
        <ApiClientProvider client={apiClient}>
          <ChatAgentProvider agentInstanceId={AGENT_ID} conversationId={1}>
            {children}
          </ChatAgentProvider>
        </ApiClientProvider>
      </JotaiProvider>
    );
  }

  return Wrapper;
}

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(fetchPlan).mockReset();
});

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: "0",
    title: "Generate Task Execution Plan",
    status: PlanStepStatusSchema.enum.COMPLETED,
    toolCalls: [],
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    planId: "7",
    status: PlanStatusSchema.enum.RUNNING,
    steps: [step()],
    ...overrides,
  };
}

// Seed `plansAtom` with `p` (replacing the whole Map by a fresh reference, as
// `use-plan` does each poll) and return the store.
function seed(p: Plan | undefined): ReturnType<typeof createStore> {
  const store = createStore();
  if (p) {
    store.set(plansAtom, new Map([[p.planId, p]]));
  }
  return store;
}

// One poll tick: swap in a fresh Map carrying `p` (the writer's reference churn).
function poll(store: ReturnType<typeof createStore>, p: Plan): void {
  act(() => {
    store.set(plansAtom, new Map([[p.planId, p]]));
  });
}

describe("PlanCard", () => {
  it("seeds collapsed when first observed status is terminal (history/reconnect into finished plan)", () => {
    const store = seed(plan({ status: PlanStatusSchema.enum.COMPLETED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });

    expect(screen.getByText("Execution completed")).toBeInTheDocument();
    // Body is collapsed (animator at 0fr) — the step list is clipped away.
    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[0fr]");
  });

  it("opens a terminal-seeded collapsed card when the header is clicked", async () => {
    // Repro: a history plan seeds collapsed (no RUNNING edge ever fires). The
    // user clicks the header to open it — the body animator expands to 1fr.
    const user = userEvent.setup();
    const store = seed(plan({ status: PlanStatusSchema.enum.COMPLETED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });

    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[0fr]");

    await user.click(screen.getByText("Execution completed"));
    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[1fr]");
  });

  it("seeds expanded when first observed status is RUNNING", () => {
    const store = seed(plan({ status: PlanStatusSchema.enum.RUNNING }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });

    expect(screen.getByText("Execution in progress")).toBeInTheDocument();
    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[1fr]");
  });

  it("auto-collapses exactly once on RUNNING→terminal, not every poll", () => {
    const store = seed(plan({ status: PlanStatusSchema.enum.RUNNING }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[1fr]");

    // The RUNNING→COMPLETED edge collapses the body once.
    poll(store, plan({ status: PlanStatusSchema.enum.COMPLETED }));
    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[0fr]");
  });

  it("a user re-expand after the edge is NOT stomped on the next 2s tick", async () => {
    const user = userEvent.setup();
    const store = seed(plan({ status: PlanStatusSchema.enum.RUNNING }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });

    // Edge fires → collapsed.
    poll(store, plan({ status: PlanStatusSchema.enum.COMPLETED }));
    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[0fr]");

    // User manually re-expands.
    await user.click(screen.getByText("Execution completed"));
    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[1fr]");

    // A later poll with the SAME terminal status must not re-collapse.
    poll(store, plan({ status: PlanStatusSchema.enum.COMPLETED }));
    expect(screen.getByTestId("plan-animator")).toHaveClass("grid-rows-[1fr]");
  });

  it("renders a header spacer until the first poll returns (no plan yet)", () => {
    // History hands the card a plan POINTER; the tree arrives a beat later via
    // the /plan poll. Reserve the header height with an empty h-9 spacer instead
    // of collapsing to 0 → no layout shift on history load (#190).
    const store = seed(undefined);
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByTestId("plan-header-spacer")).toBeInTheDocument();
  });

  it("renders null when the plan is known but has no steps", () => {
    // A polled plan with zero steps is genuinely empty (not the loading window):
    // stay null, no spacer — else a stepless plan shows a permanent stub.
    const store = seed(
      plan({ status: PlanStatusSchema.enum.RUNNING, steps: [] }),
    );
    const { container } = render(<PlanCard planId="7" />, {
      wrapper: withStore(store),
    });
    expect(screen.queryByTestId("plan-header-spacer")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("executedSteps keeps a stable reference when steps are unchanged across polls", () => {
    // Both observable effects of the memo: PENDING steps are filtered out, and
    // the surviving rows stay rendered identically across an unchanged poll.
    const steps: PlanStep[] = [
      step({ id: "0", title: "Done step" }),
      step({
        id: "1",
        title: "Pending step",
        status: PlanStepStatusSchema.enum.PENDING,
      }),
    ];
    const p = plan({ status: PlanStatusSchema.enum.RUNNING, steps });
    const store = seed(p);
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });

    expect(screen.getByText("Done step")).toBeInTheDocument();
    expect(screen.queryByText("Pending step")).not.toBeInTheDocument();

    // Re-poll the SAME plan (same `steps` ref) — the executed row is still there.
    poll(store, p);
    expect(screen.getByText("Done step")).toBeInTheDocument();
  });

  it("labels a FAILED plan 'Execution failed'", () => {
    const store = seed(plan({ status: PlanStatusSchema.enum.FAILED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByText("Execution failed")).toBeInTheDocument();
  });

  it("labels a CANCELLED plan 'Execution stopped'", () => {
    const store = seed(plan({ status: PlanStatusSchema.enum.CANCELLED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByText("Execution stopped")).toBeInTheDocument();
  });

  it("labels REQUIRE_HUMAN_INPUT as completed", () => {
    const store = seed(
      plan({ status: PlanStatusSchema.enum.REQUIRE_HUMAN_INPUT }),
    );
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByText("Execution completed")).toBeInTheDocument();
  });

  it("shows a leading spinner only while in progress", () => {
    const store = seed(plan({ status: PlanStatusSchema.enum.RUNNING }));
    const { container } = render(<PlanCard planId="7" />, {
      wrapper: withStore(store),
    });
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("places the header icon in the same w-4 rail column as the step dots", () => {
    // The header icon shares the steps' 16px rail lane so the whole timeline
    // (header glyph → every step dot) lines up on one vertical axis.
    const store = seed(plan({ status: PlanStatusSchema.enum.RUNNING }));
    const { container } = render(<PlanCard planId="7" />, {
      wrapper: withStore(store),
    });
    expect(container.querySelector(".w-4.flex-col")).toBeInTheDocument();
  });

  it("connects the header icon down to the first step while expanded", () => {
    // A descending guide line drops from the header glyph into the step list, so
    // the header and the first dot are visually joined (not disconnected).
    const store = seed(plan({ status: PlanStatusSchema.enum.RUNNING }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByTestId("header-connector")).toBeInTheDocument();
  });

  it("drops the header connector when collapsed (terminal-seeded card)", () => {
    const store = seed(plan({ status: PlanStatusSchema.enum.COMPLETED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    // A terminal plan seeds collapsed → no dangling line below the header icon.
    expect(screen.queryByTestId("header-connector")).not.toBeInTheDocument();
  });

  it("shows a check icon in a completed terminal header", () => {
    // Restored from legacy PlanCard:239 — a completed plan's header leads with a
    // check glyph (CheckmarkCircle → lucide CircleCheck). Keyed on lucide's
    // stable `lucide-circle-check` class; the step-row dots carry no testid so
    // the header icon is the sole `plan-status-icon`.
    const store = seed(plan({ status: PlanStatusSchema.enum.COMPLETED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByTestId("plan-status-icon")).toHaveClass(
      "lucide-circle-check",
    );
  });

  it("shows a check icon for a require-human-input header (labelled completed)", () => {
    const store = seed(
      plan({ status: PlanStatusSchema.enum.REQUIRE_HUMAN_INPUT }),
    );
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByTestId("plan-status-icon")).toHaveClass(
      "lucide-circle-check",
    );
  });

  it("shows a warning icon in a failed header", () => {
    // Legacy PlanCard:236 led a failed header with Warning12Filled → lucide
    // TriangleAlert.
    const store = seed(plan({ status: PlanStatusSchema.enum.FAILED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByTestId("plan-status-icon")).toHaveClass(
      "lucide-triangle-alert",
    );
  });

  it("shows a dismiss icon in a cancelled header", () => {
    // Legacy PlanCard:238 led a cancelled header with DismissCircle → lucide
    // CircleX.
    const store = seed(plan({ status: PlanStatusSchema.enum.CANCELLED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByTestId("plan-status-icon")).toHaveClass(
      "lucide-circle-x",
    );
  });

  it("places the terminal header icon in the same w-4 rail lane as the step dots", () => {
    // With the icon restored, a terminal header renders the w-4 rail column too,
    // so its glyph shares the steps' vertical axis (not flush-left). Scoped to
    // the header button so the collapsed step rows' own rails don't match.
    const store = seed(plan({ status: PlanStatusSchema.enum.COMPLETED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    const header = screen.getByRole("button", { name: /execution completed/i });
    expect(header.querySelector(".w-4.flex-col")).toBeInTheDocument();
  });

  it("draws a bottom border under the expanded body of a terminal plan", async () => {
    // Legacy PlanCard:258 closes a completed plan's step list with a divider;
    // the expanded body carries a bottom border once the plan is terminal. A
    // terminal plan seeds collapsed, so open it first.
    const user = userEvent.setup();
    const store = seed(plan({ status: PlanStatusSchema.enum.COMPLETED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    await user.click(screen.getByText("Execution completed"));
    expect(screen.getByTestId("plan-body")).toHaveClass("border-b");
  });

  it("omits the bottom border while the plan is still RUNNING", () => {
    const store = seed(plan({ status: PlanStatusSchema.enum.RUNNING }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    // RUNNING seeds expanded — the body is present but unbordered.
    expect(screen.getByTestId("plan-body")).not.toHaveClass("border-b");
  });

  it("keeps the chevron hugging the label, not pushed to the row end", () => {
    // Figma 16224-37393: `Execution completed >` — the chevron sits right after
    // the text (gap), not flung to the far right by a `flex-1` label.
    const store = seed(plan({ status: PlanStatusSchema.enum.COMPLETED }));
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    const label = screen.getByText("Execution completed");
    expect(label).not.toHaveClass("flex-1");
  });

  it("filters PENDING steps out of the expanded body", () => {
    const store = seed(
      plan({
        status: PlanStatusSchema.enum.RUNNING,
        steps: [
          step({
            id: "0",
            title: "Visible",
            status: PlanStepStatusSchema.enum.IN_PROGRESS,
          }),
          step({
            id: "1",
            title: "Hidden",
            status: PlanStepStatusSchema.enum.PENDING,
          }),
        ],
      }),
    );
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("renders null when the plan has no executable steps yet", () => {
    const store = seed(
      plan({ status: PlanStatusSchema.enum.RUNNING, steps: [] }),
    );
    const { container } = render(<PlanCard planId="7" />, {
      wrapper: withStore(store),
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the header for a RUNNING plan whose steps are all still PENDING (body empty, card visible)", () => {
    // Real-backend repro (turn 32): a freshly-created RUNNING plan carries 3
    // steps all PENDING, so `executedSteps` is empty — but the card header must
    // still show (legacy keys its null gate off the RAW step count, not the
    // filtered one). Gating on `executedSteps` here hid the whole card.
    const store = seed(
      plan({
        status: PlanStatusSchema.enum.RUNNING,
        steps: [
          step({
            id: "0",
            title: "P0",
            status: PlanStepStatusSchema.enum.PENDING,
          }),
          step({
            id: "1",
            title: "P1",
            status: PlanStepStatusSchema.enum.PENDING,
          }),
          step({
            id: "2",
            title: "P2",
            status: PlanStepStatusSchema.enum.PENDING,
          }),
        ],
      }),
    );
    render(<PlanCard planId="7" />, { wrapper: withStore(store) });
    // Header visible…
    expect(screen.getByText("Execution in progress")).toBeInTheDocument();
    // …but no PENDING step row in the body.
    expect(screen.queryByText("P0")).not.toBeInTheDocument();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const store = seed(
      plan({
        status: PlanStatusSchema.enum.RUNNING,
        steps: [step({ status: PlanStepStatusSchema.enum.FAILED })],
      }),
    );
    const { container } = render(<PlanCard planId="7" />, {
      wrapper: withStore(store),
    });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("mounts the /plan poll for its turn — an empty card fills its rows from the first poll", async () => {
    // History hands the card a plan POINTER only (planId); the step rows live
    // behind GET /plan. So the card must own the poll: seeded with no plan, it
    // renders null, then the first 2s tick fetches the tree and shows the rows.
    vi.useFakeTimers();
    const store = seed(undefined);
    vi.mocked(fetchPlan).mockResolvedValue(
      plan({
        planId: "7",
        status: PlanStatusSchema.enum.RUNNING,
        steps: [step({ title: "Polled row" })],
      }),
    );

    render(<PlanCard planId="7" />, {
      wrapper: withStore(store),
    });
    // Before the poll returns the card holds a header spacer (not empty) so the
    // header height is reserved on history load (#190).
    expect(screen.getByTestId("plan-header-spacer")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Polled by the agent id from context + the turn id derived from planId.
    expect(fetchPlan).toHaveBeenCalledWith(apiClient, {
      agentInstanceId: AGENT_ID,
      turnId: 7,
      conversationId: 1,
    });
    expect(screen.getByText("Polled row")).toBeInTheDocument();
    // The spacer is gone once the real header + rows render.
    expect(screen.queryByTestId("plan-header-spacer")).not.toBeInTheDocument();
  });
});
