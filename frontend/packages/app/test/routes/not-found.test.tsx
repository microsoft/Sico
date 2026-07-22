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
