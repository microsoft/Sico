import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Studio } from "@/features/studio/components/studio";
import { type SingleAgentCard } from "@/features/studio/schemas/single-agent-card";

const mockSuspense = vi.fn();
vi.mock("@/features/studio/hooks/use-agent-infos-query", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/studio/hooks/use-agent-infos-query")
  >("@/features/studio/hooks/use-agent-infos-query");
  return {
    ...actual,
    useAgentInfosSuspenseQuery: () => mockSuspense(),
  };
});

function returnAgents(agents: SingleAgentCard[]): void {
  mockSuspense.mockImplementation(() => ({ data: agents }));
}

function throwPending(): void {
  mockSuspense.mockImplementation(() => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense unwraps thrown Promises to render the fallback.
    throw new Promise(() => {});
  });
}

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Studio />,
  });
  const setupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/$agentId/setup",
    component: () => <div>setup</div>,
  });
  const createRouteNode = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/setup",
    component: () => <div>create-setup</div>,
  });
  const router: AnyRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, setupRoute, createRouteNode]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  render(
    <Wrapper>
      <RouterProvider router={router} />
    </Wrapper>,
  );
}

beforeEach(() => {
  mockSuspense.mockReset();
});

describe("<Studio>", () => {
  it("renders the Studio title and subtitle", () => {
    throwPending();
    render(<Studio />);
    screen.getByRole("heading", { name: "Studio" });
    screen.getByText("Configure and deploy digital worker");
  });

  it("renders skeletons while suspending", () => {
    throwPending();
    render(<Studio />);
    expect(
      screen.getAllByTestId("digital-worker-card-skeleton").length,
    ).toBeGreaterThan(0);
  });

  it("renders cards from the agent-infos query", async () => {
    returnAgents([
      { agentId: "1", name: "First", creatorUsername: "alice" },
      { agentId: "2", name: "Second", creatorUsername: "bob" },
    ]);
    renderPage();
    const links = await screen.findAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/studio/1/setup");
  });

  it("renders empty state when there are no agents", async () => {
    returnAgents([]);
    renderPage();
    await screen.findByText("No digital workers yet");
  });

  it("navigates to create-mode setup when Create is clicked", async () => {
    returnAgents([]);
    renderPage();
    await screen.findByText("No digital workers yet");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("create-setup");
  });
});
