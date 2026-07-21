import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StudioCard } from "@/features/studio/components/studio-card";
import { type SingleAgentCard } from "@/features/studio/schemas/single-agent-card";

const agent: SingleAgentCard = {
  agentId: "agent-7",
  name: "Ryan",
  role: "Engineer",
  creatorUsername: "alice",
};

function renderCard(props: { agent: SingleAgentCard }): void {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <StudioCard agent={props.agent} />,
  });
  const setupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/$agentId/setup",
    component: () => <div>setup</div>,
  });
  const router: AnyRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, setupRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("<StudioCard>", () => {
  it("renders name, role, and creator username", async () => {
    renderCard({ agent });
    await screen.findByText("Ryan");
    screen.getByText("Engineer");
    screen.getByText("alice");
  });

  it("links to the agent's setup page using the string agentId", async () => {
    renderCard({ agent });
    const link = await screen.findByRole("link", {
      name: "Open Ryan's setup",
    });
    expect(link).toHaveAttribute("href", "/studio/agent-7/setup");
  });

  it("renders the initial-based avatar (uppercased first letter)", async () => {
    renderCard({ agent });
    await screen.findByRole("link", { name: "Open Ryan's setup" });
    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("is keyboard reachable (focusable)", async () => {
    renderCard({ agent });
    const link = await screen.findByRole("link");
    link.focus();
    expect(link).toHaveFocus();
  });

  it("hides creator row when creatorUsername is missing", async () => {
    renderCard({ agent: { ...agent, creatorUsername: undefined } });
    await screen.findByText("Ryan");
    expect(screen.queryByTestId("creator-icon")).not.toBeInTheDocument();
  });
});
