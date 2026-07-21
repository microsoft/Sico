import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  userModeAtom,
} from "@sico/shared";
import {
  setItemToLocalStorage,
  USER_MODE_LS,
} from "@sico/shared/utils/local-storage.ts";
import { toast } from "@sico/ui";
import { QueryClient } from "@tanstack/react-query";
import type { RegisteredRouter } from "@tanstack/react-router";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { router as appRouter } from "@/router";

import { routeTree } from "../../src/routeTree.gen";
import { store } from "../../src/store";
import { clearAuthStorage } from "../_helpers/clear-auth-storage";

// `<LoginForm>` is exercised by its own RTL test in @sico/shared; mock
// it here so route-level assertions (beforeLoad, toast, ?code strip)
// stay focused. Path mirrors the source import in `routes/login.tsx`.
// The mock exposes a button that fires `onSuccess(data, mode)` so the
// success-path (mode persistence + landing) can be driven from a test.
vi.mock("@sico/shared/features/rbac-login/components/login-form.tsx", () => ({
  LoginForm: vi.fn(
    (props: {
      onSuccess?: (data: unknown, mode: "operator" | "developer") => void;
    }) => (
      <button
        data-testid="login-form"
        type="button"
        onClick={() => props.onSuccess?.({}, "developer")}
      />
    ),
  ),
}));

// `toast` is re-exported through `@sico/ui` — mock the same surface the
// route imports. Keep the partial mock minimal; other UI exports stay real.
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return {
    ...actual,
    toast: { error: vi.fn() },
  };
});

const mockedToastError = vi.mocked(toast.error);

// `login.tsx`'s onSuccess navigates via the module-singleton router
// (`@/router`), not the test-rendered router. Mock it so the success path
// can run without touching the real app router, and assert the target.
vi.mock("@/router", () => ({
  router: { navigate: vi.fn() },
}));

function renderAt(initialPath: string): { router: RegisteredRouter } {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient: new QueryClient(), apiClient: {} as never },
  });
  render(
    <JotaiProvider store={store}>
      <RouterProvider router={router} />
    </JotaiProvider>,
  );
  return { router };
}

describe("/login route", () => {
  beforeEach(() => {
    clearAuthStorage();
    // Drop any cached mode so each test starts from the operator default.
    store.set(userModeAtom, "operator");
    clearAuthStorage();
    mockedToastError.mockReset();
  });

  afterEach(() => {
    clearAuthStorage();
  });

  it("renders <LoginForm> when unauthed", async () => {
    renderAt("/login");
    await screen.findByTestId("login-form");
    expect(mockedToastError).not.toHaveBeenCalled();
  });

  it("redirects authed user to /digital-worker — does not render LoginForm", async () => {
    setItemToLocalStorage(AUTH_TOKEN_LS, "fake-token");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "u@example.test", roles: [] }),
    );
    // Far-future expiry above the epoch-ms floor in auth-storage.
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, "9999999999999");

    const { router } = renderAt("/login");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/digital-worker");
    });
    expect(screen.queryByTestId("login-form")).not.toBeInTheDocument();
  });

  it("redirects authed developer to /studio", async () => {
    setItemToLocalStorage(AUTH_TOKEN_LS, "fake-token");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "u@example.test", roles: [] }),
    );
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, "9999999999999");
    setItemToLocalStorage(USER_MODE_LS, "developer");

    const { router } = renderAt("/login");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/studio");
    });
    expect(screen.queryByTestId("login-form")).not.toBeInTheDocument();
  });

  it("on developer login success, updates userModeAtom immediately (not just LS) and navigates to /studio", async () => {
    const mockedNavigate = vi.mocked(appRouter.navigate);
    mockedNavigate.mockClear();

    renderAt("/login");
    const form = await screen.findByTestId("login-form");

    // Baseline: cached atom is the operator default before success.
    expect(store.get(userModeAtom)).toBe("operator");

    // Drive the mocked LoginForm's onSuccess(data, "developer").
    fireEvent.click(form);

    // The atom must flip synchronously via the write — subscribers
    // (ModeGuard + sidebar) re-render without a page refresh. This is the
    // regression: writing LS alone left the atom stale until a refresh.
    expect(store.get(userModeAtom)).toBe("developer");

    // Landing branch resolves to the developer home.
    expect(mockedNavigate).toHaveBeenCalledWith({
      to: "/studio",
      replace: true,
    });
  });

  it("on /login?code=401 fires a session-expired toast", async () => {
    renderAt("/login?code=401");
    await waitFor(() => {
      expect(mockedToastError).toHaveBeenCalledWith(
        "Your session has expired. Please sign in again.",
        expect.objectContaining({ id: "session-expired" }),
      );
    });
  });

  it("on /login?code=401 calls toast with stable id 'session-expired' so StrictMode does not stack duplicates", async () => {
    renderAt("/login?code=401");
    await waitFor(() => {
      expect(mockedToastError).toHaveBeenCalledWith(
        "Your session has expired. Please sign in again.",
        { id: "session-expired" },
      );
    });
  });

  it("on /login?code=401 strips `?code` from the URL after the loader fires", async () => {
    const { router } = renderAt("/login?code=401");
    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty("code");
    });
    // Pathname stays /login; only `?code` is stripped.
    expect(router.state.location.pathname).toBe("/login");
  });

  it("accepts `?next` at the 2048-char cap (positive control)", async () => {
    // 2048 chars exactly — must still parse and mount LoginForm.
    const atCap = `/${"a".repeat(2047)}`;
    expect(atCap.length).toBe(2048);
    renderAt(`/login?next=${atCap}`);
    await screen.findByTestId("login-form");
  });

  it("rejects `?next` longer than 2048 chars — LoginForm never mounts", async () => {
    const oversized = `/${"a".repeat(2048)}`; // 2049 chars
    expect(oversized.length).toBeGreaterThan(2048);
    expect(() => {
      renderAt(`/login?next=${oversized}`);
    }).not.toThrow();
    // Schema rejection means the route surfaces an error rather than
    // mounting LoginForm. Give the router a couple ticks to settle, then
    // confirm the form is absent.
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(50);
    } finally {
      vi.useRealTimers();
    }
    expect(screen.queryByTestId("login-form")).not.toBeInTheDocument();
  });
});
