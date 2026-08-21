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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegisterPage } from "@/features/rbac-login/components/register-page";
import { authModeSearchSchema } from "@/features/rbac-login/schemas/auth-mode";

type MockRegisterFormProps = {
  onLogin: (mode: "operator" | "developer") => void;
  onSuccess: (data: { id: string }, mode: "operator" | "developer") => void;
};

const registerFormState = vi.hoisted(() => ({
  props: null as MockRegisterFormProps | null,
}));

vi.mock("@/features/rbac-login/components/register-form.tsx", () => ({
  RegisterForm: vi.fn((props: MockRegisterFormProps) => {
    registerFormState.props = props;
    return (
      <>
        <button
          data-testid="register-form"
          type="button"
          onClick={() => props.onSuccess({ id: "user-1" }, "developer")}
        />
        <button
          data-testid="login-link"
          type="button"
          onClick={() => props.onLogin("developer")}
        />
      </>
    );
  }),
}));

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn() } };
});

function makeRouter(initialPath: string): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/register",
    validateSearch: authModeSearchSchema,
    component: RegisterPage,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: () => null,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([registerRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

function renderAt(initialPath: string): { router: AnyRouter } {
  const router = makeRouter(initialPath);
  render(<RouterProvider router={router} />);
  return { router };
}

describe("<RegisterPage>", () => {
  beforeEach(() => {
    registerFormState.props = null;
    vi.mocked(toast.success).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns to the matching login mode", async () => {
    const { router } = renderAt("/register?mode=developer");
    await screen.findByTestId("register-form");

    fireEvent.click(screen.getByTestId("login-link"));

    await waitFor(() => {
      expect(router.state.location).toMatchObject({
        pathname: "/login",
        search: { mode: "developer" },
      });
    });
  });

  it("shows success immediately and redirects after two seconds", async () => {
    const { router } = renderAt("/register?mode=developer");
    await screen.findByTestId("register-form");
    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId("register-form"));
    expect(toast.success).toHaveBeenCalledWith("Account Created", {
      id: "account-created",
    });
    expect(router.state.location.pathname).toBe("/register");

    await vi.advanceTimersByTimeAsync(2000);
    expect(router.state.location).toMatchObject({
      pathname: "/login",
      search: { mode: "developer" },
    });
  });

  it("cancels a scheduled redirect after leaving registration", async () => {
    const { router } = renderAt("/register?mode=developer");
    await screen.findByTestId("register-form");
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("register-form"));

    await router.navigate({ to: "/login" });
    await vi.advanceTimersByTimeAsync(2000);

    expect(router.state.location.pathname).toBe("/login");
  });

  it("ignores a late success callback after leaving registration", async () => {
    const { router } = renderAt("/register");
    await screen.findByTestId("register-form");
    const props = registerFormState.props;
    if (!props) {
      throw new Error("RegisterForm props were not captured");
    }

    await router.navigate({ to: "/login" });
    props.onSuccess({ id: "user-1" }, "developer");

    expect(toast.success).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/login");
  });
});
