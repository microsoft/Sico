import { toast } from "@sico/ui";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userModeAtom } from "@/atoms/user-mode-atom";
import { LoginPage } from "@/features/rbac-login/components/login-page";
import { loginSearchSchema } from "@/features/rbac-login/schemas/login-search";

// `<LoginForm>` is exercised by its own RTL test; mock it here so page-level
// assertions (toast, ?code strip, success landing, register nav) stay focused.
vi.mock("@/features/rbac-login/components/login-form.tsx", () => ({
  LoginForm: vi.fn(
    (props: {
      onSuccess?: (data: unknown, mode: "operator" | "developer") => void;
      onRegister?: (mode: "operator" | "developer") => void;
    }) => (
      <>
        <button
          data-testid="login-form"
          type="button"
          onClick={() => props.onSuccess?.({}, "developer")}
        />
        <button
          data-testid="register-link"
          type="button"
          onClick={() => props.onRegister?.("developer")}
        />
      </>
    ),
  ),
}));

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { error: vi.fn() } };
});

const mockedToastError = vi.mocked(toast.error);

// Minimal tree giving `useSearch`/`useNavigate({ from: "/login" })` their route
// IDs, plus landing stubs so success/register navigation resolves.
function makeRouter(initialPath: string): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    validateSearch: loginSearchSchema,
    component: LoginPage,
  });
  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/register",
    component: () => null,
  });
  const studioRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio",
    component: () => null,
  });
  const digitalWorkerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/digital-worker",
    component: () => null,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([
      loginRoute,
      registerRoute,
      studioRoute,
      digitalWorkerRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

function renderAt(initialPath: string): {
  router: AnyRouter;
  store: ReturnType<typeof createStore>;
} {
  const router = makeRouter(initialPath);
  const store = createStore();
  render(
    <JotaiProvider store={store}>
      <RouterProvider router={router} />
    </JotaiProvider>,
  );
  return { router, store };
}

describe("<LoginPage>", () => {
  beforeEach(() => {
    mockedToastError.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the login form on a clean visit without a toast", async () => {
    renderAt("/login");
    await screen.findByTestId("login-form");
    expect(mockedToastError).not.toHaveBeenCalled();
  });

  it("writes the submitted mode to the atom and navigates to its landing", async () => {
    const { router, store } = renderAt("/login");
    const form = await screen.findByTestId("login-form");
    expect(store.get(userModeAtom)).toBe("operator");

    fireEvent.click(form);

    // Atom flips synchronously so ModeGuard + sidebar re-render immediately.
    expect(store.get(userModeAtom)).toBe("developer");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/studio");
    });
  });

  it("preserves developer mode when opening registration", async () => {
    const { router } = renderAt("/login?mode=developer");
    fireEvent.click(await screen.findByTestId("register-link"));

    await waitFor(() => {
      expect(router.state.location).toMatchObject({
        pathname: "/register",
        search: { mode: "developer" },
      });
    });
  });

  it("fires a session-expired toast with a stable id on ?code=401", async () => {
    renderAt("/login?code=401");
    await waitFor(() => {
      expect(mockedToastError).toHaveBeenCalledWith(
        "Your session has expired. Please sign in again.",
        { id: "session-expired" },
      );
    });
  });

  it("strips ?code from the URL after the effect fires", async () => {
    const { router } = renderAt("/login?code=401");
    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty("code");
    });
    expect(router.state.location.pathname).toBe("/login");
  });
});
