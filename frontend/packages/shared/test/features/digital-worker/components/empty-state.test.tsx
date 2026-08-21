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
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "@/features/digital-worker/components/empty-state";

function renderEmpty(props: {
  hasProject?: boolean;
  onAddDw?: () => void;
}): void {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <EmptyState hasProject={props.hasProject} onAddDw={props.onAddDw} />
    ),
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/project",
    component: () => <div>project page</div>,
  });
  const router: AnyRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, projectRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("EmptyState", () => {
  it("renders the shared heading", async () => {
    renderEmpty({ hasProject: true });
    await screen.findByText("Your crew is one hire away");
  });

  it("renders the empty illustration as decorative", async () => {
    renderEmpty({ hasProject: true });
    const img = await screen.findByTestId("message-state-illustration");
    expect(img.getAttribute("src")).toContain("empty-people.svg");
    expect(img).toHaveAttribute("alt", "");
  });

  it("offers an Add digital worker CTA when the user has a project", async () => {
    const onAddDw = vi.fn();
    renderEmpty({ hasProject: true, onAddDw });
    const button = await screen.findByRole("button", {
      name: /add digital worker/i,
    });
    button.click();
    expect(onAddDw).toHaveBeenCalledOnce();
  });

  it("offers a Create project CTA (with no-project copy) when the user has no project", async () => {
    renderEmpty({ hasProject: false });
    await screen.findByText(
      "You need a project before adding a digital worker.",
    );
    await screen.findByRole("button", { name: /create project/i });
  });
});
