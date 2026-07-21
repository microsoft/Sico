import { QueryClient } from "@tanstack/react-query";
import type { RegisteredRouter } from "@tanstack/react-router";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { routeTree } from "../../src/routeTree.gen";

// `RegisteredRouter` resolves through the global `Register` augmentation
// in `@/router.ts`, so callers get typed access to
// `router.state.location.search` against the real routeTree.
function renderAt(initialPath: string): { router: RegisteredRouter } {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient: new QueryClient(), apiClient: {} as never },
  });
  render(<RouterProvider router={router} />);
  return { router };
}

describe("<NotFound>", () => {
  // axe-core `page-has-heading-one` requires every route to expose its
  // own <h1> (pages own their <h1>; layouts do not).
  it("renders <h1>Page not found</h1>", async () => {
    renderAt("/this-route-does-not-exist");
    await screen.findByRole("heading", {
      level: 1,
      name: /page not found/i,
    });
  });

  it("renders supporting copy explaining the 404", async () => {
    renderAt("/this-route-does-not-exist");
    await screen.findByText(/does not exist or has been moved/i);
  });

  it("renders a typed Link back to /digital-worker", async () => {
    renderAt("/this-route-does-not-exist");
    const link = await screen.findByRole("link", { name: /back to home/i });
    expect(link).toHaveAttribute("href", "/digital-worker");
  });
});
