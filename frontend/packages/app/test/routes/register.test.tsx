import { AUTH_EXPIRES_AT_LS, AUTH_TOKEN_LS, AUTH_USER_LS } from "@sico/shared";
import { setItemToLocalStorage } from "@sico/shared/utils/local-storage.ts";
import { toast } from "@sico/ui";
import { QueryClient } from "@tanstack/react-query";
import type { RegisteredRouter } from "@tanstack/react-router";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../src/routeTree.gen";
import { clearAuthStorage } from "../_helpers/clear-auth-storage";

type MockRegisterFormProps = {
  onLogin: (mode: "operator" | "developer") => void;
  onSuccess: (data: { id: string }, mode: "operator" | "developer") => void;
};

const registerFormState = vi.hoisted(() => ({
  props: null as MockRegisterFormProps | null,
}));

vi.mock(
  "@sico/shared/features/rbac-login/components/register-form.tsx",
  () => ({
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
  }),
);

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return {
    ...actual,
    toast: { success: vi.fn() },
  };
});

function renderAt(initialPath: string): { router: RegisteredRouter } {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient: new QueryClient(), apiClient: axios.create() },
  });
  render(<RouterProvider router={router} />);
  return { router };
}

describe("/register route", () => {
  beforeEach(() => {
    clearAuthStorage();
    registerFormState.props = null;
    vi.mocked(toast.success).mockReset();
  });

  afterEach(() => {
    clearAuthStorage();
    vi.useRealTimers();
  });

  it("renders the requested developer mode", async () => {
    renderAt("/register?mode=developer");

    expect(await screen.findByRole("img", { name: "SICO.Dev" })).toBeVisible();
    expect(screen.getByTestId("register-form")).toBeVisible();
  });

  it("redirects an authenticated user instead of rendering registration", async () => {
    setItemToLocalStorage(AUTH_TOKEN_LS, "fake-token");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "u@example.test", roles: [] }),
    );
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, "9999999999999");
    const { router } = renderAt("/register");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/digital-worker");
    });
    expect(screen.queryByTestId("register-form")).toBeNull();
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
    expect(router.state.location.search).toEqual({});
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
