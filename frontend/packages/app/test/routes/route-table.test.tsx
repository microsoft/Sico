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
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { routeTree } from "../../src/routeTree.gen";
import { clearAuthStorage } from "../_helpers/clear-auth-storage";

// `<LoginForm>` mounts react-query / react-hook-form — out of scope for
// route-table assertions, which only care about navigation. Form
// behaviour is covered by @sico/shared's own RTL tests.
vi.mock("@sico/shared/features/rbac-login/components/login-form.tsx", () => ({
  LoginForm: vi.fn(() => <div data-testid="login-form" />),
}));

// `RegisteredRouter` (via `Register` augmentation in `@/router.ts`)
// types `router.state.location.search` against the routeTree.
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

describe("route table", () => {
  it("renders 404 for unknown path", async () => {
    renderAt("/this-does-not-exist");
    await screen.findByText(/page not found/i);
  });

  it("renders login at /login (unauthenticated)", async () => {
    clearAuthStorage();
    renderAt("/login");
    // LoginLayout renders the SICO brand logo in its topbar; the page
    // body is the mocked LoginForm (see vi.mock above).
    expect(await screen.findByRole("img", { name: /sico/i })).toBeVisible();
  });

  it("redirects unauthenticated /digital-worker to /login?code=401&next=/digital-worker", async () => {
    clearAuthStorage();
    const { router } = renderAt("/digital-worker");
    // beforeLoad redirect resolves in a microtask. Assert on
    // router.state.location so a stray "login" in DOM doesn't match.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    // `next` survives the `/login` route's `?code` strip (see
    // `routes/login.tsx` useEffect). `code` arrives on the redirect URL
    // but is stripped after the toast fires.
    expect(router.state.location.search).toMatchObject({
      next: "/digital-worker",
    });
  });
});
