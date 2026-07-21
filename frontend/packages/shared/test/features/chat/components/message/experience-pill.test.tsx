import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExperiencePill } from "@/features/chat/components/message/experience-pill";
import { ChatAgentProvider } from "@/features/chat/services/chat-agent-context";
import type { Agent } from "@/features/digital-worker";
import * as agentService from "@/features/digital-worker/services/agents";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/digital-worker/services/agents");

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigate };
});

const AGENT_ID = 601;
const PROJECT_ID = 84;
const agentWithProject: Agent = {
  id: AGENT_ID,
  name: "Max",
  project: { id: PROJECT_ID, name: "SICO" },
};

// Render the pill inside the chat providers, seeding the agent detail so
// `projectId` resolves on first render. Pass an agent without `project` to model
// the no-owning-project case (View more must then disable).
function renderPill(
  ui: ReactElement,
  agent: Agent = agentWithProject,
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(["agents", "detail", AGENT_ID], agent);
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <ChatAgentProvider agentInstanceId={AGENT_ID} conversationId={1}>
          {ui}
        </ChatAgentProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return user;
}

beforeEach(() => {
  navigate.mockClear();
  vi.mocked(agentService.fetchAgentDetail).mockReset();
  vi.mocked(agentService.fetchAgentDetail).mockResolvedValue(agentWithProject);
});

describe("ExperiencePill", () => {
  it("renders an `Experience + {N}` pill when the count is positive", () => {
    renderPill(<ExperiencePill experienceCount={11} planCompleted />);
    expect(screen.getByText("Experience + 11")).toBeInTheDocument();
  });

  it("sizes the pill to its content (w-fit), not the full row width", () => {
    // Regression: the PopoverTrigger button defaulted to stretching full-width
    // inside the message-card's `flex flex-col`, rendering as a grey bar across
    // the whole turn instead of a hug-content pill (Figma 18991-47827).
    renderPill(<ExperiencePill experienceCount={2} planCompleted />);
    expect(screen.getByRole("button", { name: /experience/i })).toHaveClass(
      "w-fit",
    );
  });

  it("shows the pill on a positive count even before the plan completes", () => {
    // M1: `experienceCount > 0` wins regardless of completion — the count is
    // the signal, not the plan's terminal state.
    renderPill(<ExperiencePill experienceCount={3} planCompleted={false} />);
    expect(screen.getByText("Experience + 3")).toBeInTheDocument();
  });

  it("opens a popover with the title and `View more` on click", async () => {
    const user = renderPill(
      <ExperiencePill experienceCount={11} planCompleted />,
    );

    await user.click(screen.getByRole("button", { name: /experience/i }));

    // Title row is split: the word "Experience" + a separate `+ 11` badge. The
    // same `+ 11` also appears on the `New strategies` row below (legacy parity),
    // so assert both occurrences rather than a singular match.
    expect(await screen.findByText("Experience")).toBeInTheDocument();
    expect(screen.getAllByText("+ 11")).toHaveLength(2);
    expect(screen.getByText("View more")).toBeInTheDocument();
  });

  it("shows a `New strategies` breakdown row reusing the count (legacy parity)", async () => {
    // Legacy OperationCard.tsx:87-90 rendered a single `New strategies +N` row
    // whose N is the same numOperations as the title — a label, not a distinct
    // datum. Copied verbatim (the Figma two-row split needs a backend field this
    // slice does not model — OQ#5).
    const user = renderPill(
      <ExperiencePill experienceCount={11} planCompleted />,
    );

    await user.click(screen.getByRole("button", { name: /experience/i }));

    expect(await screen.findByText("New strategies")).toBeInTheDocument();
    // Title badge `+ 11` and the row badge `+ 11` are the same value, shown twice.
    expect(screen.getAllByText("+ 11")).toHaveLength(2);
  });

  it("navigates to the experience detail under its project when `View more` is clicked", async () => {
    const user = renderPill(
      <ExperiencePill experienceCount={11} planCompleted playbookId={7} />,
    );

    await user.click(screen.getByRole("button", { name: /experience/i }));
    await user.click(await screen.findByRole("button", { name: /view more/i }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/project/$projectId/experience/$assetId",
      params: { projectId: String(PROJECT_ID), assetId: "7" },
    });
  });

  it("renders `View more` inert (disabled, no navigation) when no playbookId", async () => {
    // OQ#5 / decoupled from #181: with no asset id the row is a dead label, never
    // a 404 jump. The pill still opens; only the footer is disabled.
    const user = renderPill(
      <ExperiencePill experienceCount={11} planCompleted />,
    );

    await user.click(screen.getByRole("button", { name: /experience/i }));
    const viewMore = await screen.findByRole("button", { name: /view more/i });
    expect(viewMore).toBeDisabled();

    await user.click(viewMore);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("renders `View more` inert when the agent has no owning project", async () => {
    // No projectId (agent.project absent) → the nested route can't be formed, so
    // the footer disables rather than navigating to a broken target.
    const user = renderPill(
      <ExperiencePill experienceCount={11} planCompleted playbookId={7} />,
      { id: AGENT_ID, name: "Max" },
    );

    await user.click(screen.getByRole("button", { name: /experience/i }));
    const viewMore = await screen.findByRole("button", { name: /view more/i });
    expect(viewMore).toBeDisabled();

    await user.click(viewMore);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("labels a completed plan with no experience `Generating experience`", () => {
    // M1: terminal-completed AND count absent/0 → the legacy generating label.
    renderPill(<ExperiencePill experienceCount={0} planCompleted />);
    expect(screen.getByText("Generating experience")).toBeInTheDocument();
    // No interactive pill in the generating state — nothing to open yet.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing while the plan runs with no experience yet", () => {
    renderPill(<ExperiencePill experienceCount={0} planCompleted={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/experience/i)).not.toBeInTheDocument();
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(<div />);
    renderPill(<ExperiencePill experienceCount={11} planCompleted />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
