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
