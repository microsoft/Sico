import { AUTH_EXPIRES_AT_LS, AUTH_TOKEN_LS, AUTH_USER_LS } from "@sico/shared";
import {
  getItemFromLocalStorage,
  setItemToLocalStorage,
} from "@sico/shared/utils/local-storage.ts";
import { QueryClient } from "@tanstack/react-query";
import type { RegisteredRouter } from "@tanstack/react-router";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { routeTree } from "../../../src/routeTree.gen";
import { clearAuthStorage } from "../../_helpers/clear-auth-storage";

// `<LoginForm>` mounts react-query / react-hook-form — out of scope for
// the AuthGate redirect contract being exercised here.
vi.mock("@sico/shared/features/rbac-login/components/login-form.tsx", () => ({
  LoginForm: vi.fn(() => <div data-testid="login-form" />),
}));

// `<Sidebar>` (mounted inside <AppShell>) needs a QueryClientProvider +
// jotai user — out of scope for AuthGate's redirect contract.
vi.mock("@sico/shared/features/sidebar/components/sidebar.tsx", () => ({
  Sidebar: () => <nav aria-label="Primary navigation" />,
}));

// `<DigitalWorkers>` needs QueryClientProvider + ApiClient — out of scope
// for AuthGate's redirect contract. Stub `agentsQueryOptions` too so the
// route's `loader` prefetch doesn't hit a real fetcher with `{}` apiClient.
vi.mock("@sico/shared/features/digital-worker/index.ts", () => ({
  DigitalWorkers: () => <h1>Digital Worker</h1>,
  agentsQueryOptions: () => ({
    queryKey: ["agents", "list", { stub: true }],
    queryFn: () => Promise.resolve({ items: [], total: 0, hasNext: false }),
    initialPageParam: 1,
    getNextPageParam: () => undefined,
  }),
}));

function renderAt(initialPath: string): { router: RegisteredRouter } {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    context: { queryClient: new QueryClient(), apiClient: {} as never },
  });
  // Fresh jotai store per render so `userAtom` doesn't leak across tests.
  const store = createStore();
  render(
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>,
  );
  return { router };
}

describe("<AuthGate>", () => {
  it("redirects to /login?code=401 when unauthenticated", async () => {
    clearAuthStorage();
    // Token present so `beforeLoad`'s sync check passes, but the user
    // payload fails `userSchema` — exercises <AuthGate>'s `useEffect`
    // gate (route-table.test covers the beforeLoad-first path).
    setItemToLocalStorage(AUTH_TOKEN_LS, "tok");
    setItemToLocalStorage(AUTH_USER_LS, JSON.stringify({ not: "a-real-user" }));
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, "9999999999999");
    const { router } = renderAt("/digital-worker");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(router.state.location.search).toMatchObject({
      next: "/digital-worker",
    });
    // `?code=401` arrives on the redirect URL but the /login route's
    // useEffect strips it after firing the session-expired toast.
    // Logout side-effect must clear the orphaned triple, else next
    // protected nav re-enters the loop.
    await waitFor(() => {
      expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBeNull();
    });
    expect(getItemFromLocalStorage(AUTH_USER_LS)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_EXPIRES_AT_LS)).toBeNull();
  });

  it("renders children when authenticated", async () => {
    setItemToLocalStorage(AUTH_TOKEN_LS, "tok");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "a@b.test", roles: [] }),
    );
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, String(Date.now() + 3_600_000));
    renderAt("/digital-worker");
    await screen.findByRole("heading", { name: /digital worker/i });
  });
});
