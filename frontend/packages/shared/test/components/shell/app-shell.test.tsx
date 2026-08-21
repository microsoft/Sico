import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientProvider } from "@/services/api-client-context";

import { restoreOnline, setOnline } from "../../helpers/network";

// Mock Sidebar to keep the shell test focused on shell concerns
// (Sidebar has its own dedicated test).
const sidebarMock = vi.fn();
vi.mock("@/features/sidebar/components/sidebar", () => ({
  Sidebar: (props: Record<string, unknown>) => {
    sidebarMock(props);
    return <nav aria-label="Primary navigation">sidebar</nav>;
  },
}));

const { AppShell } = await import("@/components/shell/app-shell");

const apiClient = {} as AxiosInstance;

// Inline routeTree fixture. `AnyRouter` because `@sico/shared` doesn't
// own a `RegisteredRouter` augmentation — that lives in the consuming
// app.
function makeRouter(initialPath: "/a" | "/b" | "/empty"): {
  router: AnyRouter;
} {
  const rootRoute = createRootRoute({
    component: function Root() {
      return (
        <ApiClientProvider client={apiClient}>
          <AppShell>
            <Outlet />
          </AppShell>
        </ApiClientProvider>
      );
    },
  });
  const aRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/a",
    component: function PageA() {
      // Pages own `tabIndex={-1}` so the focus hook can call `.focus()`.
      return <h1 tabIndex={-1}>Page A</h1>;
    },
  });
  const bRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/b",
    component: function PageB() {
      return <h1 tabIndex={-1}>Page B</h1>;
    },
  });
  const emptyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/empty",
    component: function EmptyPage() {
      return <div>no heading here</div>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([aRoute, bRoute, emptyRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return { router };
}

describe("<AppShell>", () => {
  afterEach(() => {
    restoreOnline();
  });

  it("renders <main> landmark", async () => {
    const { router } = makeRouter("/a");
    render(<RouterProvider router={router} />);
    await screen.findByRole("main");
  });

  it("mounts <Sidebar> (no aria-hidden placeholder, no apiClient prop)", async () => {
    const { router } = makeRouter("/a");
    render(<RouterProvider router={router} />);
    const nav = await screen.findByRole("navigation", {
      name: /primary navigation/i,
    });
    expect(nav).not.toHaveAttribute("aria-hidden", "true");
    // AppShell no longer prop-drills apiClient — Sidebar consumes context.
    // With no extras passed, both slots are undefined (sico's default).
    expect(sidebarMock).toHaveBeenCalledWith({
      extraNavItems: undefined,
      headerExtras: undefined,
    });
  });

  // Shell never renders its own <h1> — the focus hook's contract is
  // "one <h1> per route, owned by the page".
  it("does not render its own <h1>", async () => {
    const { router } = makeRouter("/empty");
    render(<RouterProvider router={router} />);
    await screen.findByText(/no heading here/i);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("mounts <OfflineBanner>", async () => {
    // OfflineBanner reads navigator.onLine synchronously on first render
    // via useSyncExternalStore.
    setOnline(false);
    const { router } = makeRouter("/a");
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/offline/i);
  });

  it("focuses the first <h1> after route change", async () => {
    const { router } = makeRouter("/a");
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1, name: /page a/i }),
      );
    });

    await act(async () => {
      await router.navigate({ to: "/b" });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1, name: /page b/i }),
      );
    });
  });

  // Downstream apps (dwp) inject extra nav entries; AppShell forwards them
  // verbatim to Sidebar's `extraNavItems` (rendered in both expanded + rail).
  it("forwards extraNavItems to <Sidebar>", async () => {
    const rootRoute = createRootRoute({
      component: function Root() {
        return (
          <ApiClientProvider client={apiClient}>
            <AppShell
              extraNavItems={[{ to: "/x", label: "X", icon: <span>x</span> }]}
            >
              <Outlet />
            </AppShell>
          </ApiClientProvider>
        );
      },
    });
    const aRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/a",
      component: () => <h1 tabIndex={-1}>Page A</h1>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([aRoute]),
      history: createMemoryHistory({ initialEntries: ["/a"] }),
    });
    render(<RouterProvider router={router} />);
    await screen.findByRole("navigation", { name: /primary navigation/i });
    expect(sidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({ extraNavItems: expect.anything() }),
    );
  });

  // Regression: the hook used to imperatively set `h1.tabIndex = -1`
  // on every route change (SRP violation). Pages now declare it
  // themselves; the hook only reads + focuses.
  it("does not mutate tabIndex on the focused <h1>", async () => {
    const { router } = makeRouter("/a");
    render(<RouterProvider router={router} />);

    const h1 = await screen.findByRole("heading", {
      level: 1,
      name: /page a/i,
    });
    expect(h1.getAttribute("tabindex")).toBe("-1");
  });
});
