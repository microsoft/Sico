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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { JSX, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/features/rbac-login/components/login-form";
import { useLogin } from "@/features/rbac-login/hooks/use-login";
import { ApiClientProvider } from "@/services/api-client-context";

// Mock useLogin so the form is isolated from network + atom side effects.
vi.mock("@/features/rbac-login/hooks/use-login", () => ({
  useLogin: vi.fn(),
}));

const mockedUseLogin = vi.mocked(useLogin);

function TestProviders({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const store = createStore();
  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

type Options = Parameters<typeof useLogin>[0];

let capturedOptions: Options | null = null;

function mockLoginReturn(
  overrides: Partial<ReturnType<typeof useLogin>> = {},
): ReturnType<typeof useLogin> {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
    ...overrides,
  } as Partial<ReturnType<typeof useLogin>> as ReturnType<typeof useLogin>;
}

const apiClient = axios.create({ baseURL: "/api/sico" });

describe("<LoginForm>", () => {
  beforeEach(() => {
    capturedOptions = null;
    mockedUseLogin.mockReset();
    mockedUseLogin.mockImplementation((options) => {
      capturedOptions = options;
      return mockLoginReturn();
    });
  });

  it("stays quiet on blur for an empty email — no shouting at empty fields", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    // Clear the seed pre-fill so the field is genuinely empty on blur.
    await user.clear(screen.getByLabelText(/email/i));
    await user.tab();
    // Empty + blur → triggerOnBlurIfFilled bails out, no zod error.
    expect(screen.queryByText(/valid email/i)).toBeNull();
  });

  it("surfaces inline zod error on blur when the field has content", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    await user.clear(screen.getByLabelText(/email/i));
    await user.type(screen.getByLabelText(/email/i), "notanemail");
    await user.tab();
    // Non-empty + invalid + blur → manual trigger runs zod, error shows.
    await screen.findByText(/valid email/i);
  });

  it("shows inline zod error on submit + clears on valid edit", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    await user.clear(screen.getByLabelText(/email/i));
    await user.type(screen.getByLabelText(/email/i), "notanemail");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    // Submit makes the zod failure surface.
    await screen.findByText(/valid email/i);
    // `reValidateMode: "onChange"` — error retreats the moment the
    // value becomes valid, no extra blur required.
    await user.type(screen.getByLabelText(/email/i), "@example.com");
    expect(screen.queryByText(/valid email/i)).toBeNull();
  });

  it("toggles password visibility on show/hide click", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    const pw = screen.getByLabelText("Password*");
    expect(pw).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(pw).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(pw).toHaveAttribute("type", "password");
  });

  it("renders Caps Lock hint when caps is on during typing", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    const pw = screen.getByLabelText("Password*");
    pw.focus();
    await user.keyboard("{CapsLock}A");
    screen.getByText(/caps lock is on/i);
  });

  it("marks Continue with aria-busy while submitting (mocked isPending=true)", () => {
    mockedUseLogin.mockReset();
    mockedUseLogin.mockImplementation((options) => {
      capturedOptions = options;
      return mockLoginReturn({ isPending: true });
    });
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    expect(screen.getByRole("button", { name: /continue/i })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders inline credential error + reddens both fields when useLogin invokes onCredentialsError", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    await user.clear(screen.getByLabelText(/email/i));
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.clear(screen.getByLabelText("Password*"));
    await user.type(screen.getByLabelText("Password*"), "123456");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    capturedOptions!.onCredentialsError("incorrect password");
    await screen.findByText(/incorrect email or password/i);
    // Both fields share the error — backend doesn't tell us which one was wrong.
    expect(screen.getByLabelText(/email/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Password*")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("clears credential error + un-reds both fields when user edits either field", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    await user.clear(screen.getByLabelText(/email/i));
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.clear(screen.getByLabelText("Password*"));
    await user.type(screen.getByLabelText("Password*"), "123456");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    capturedOptions!.onCredentialsError("incorrect password");
    await screen.findByText(/incorrect email or password/i);
    // Editing either field signals the user is correcting it — error retreats.
    await user.type(screen.getByLabelText(/email/i), "x");
    expect(screen.queryByText(/incorrect email or password/i)).toBeNull();
    expect(screen.getByLabelText(/email/i)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Password*")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("renders inline network error when useLogin invokes onNetworkError", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, {
      wrapper: TestProviders,
    });
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText("Password*"), "123456");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    capturedOptions!.onNetworkError("network unreachable");
    await screen.findByText(/couldn't reach the server/i);
  });

  it("invokes onSuccess with the parsed payload when useLogin's onSuccess fires", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />, {
      wrapper: TestProviders,
    });
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText("Password*"), "123456");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    const payload = {
      tokenInfo: { accessToken: "tok", expiresAt: 1_900_000_000 },
      user: {
        id: 1,
        email: "a@b.co",
        roles: [
          {
            id: 1,
            roleCode: "project_admin",
            scopeType: "project",
            scopeId: 1,
          },
        ],
      },
    };
    capturedOptions!.onSuccess(payload);
    // Single-mode (default) always reports "operator".
    expect(onSuccess).toHaveBeenCalledWith(payload, "operator");
  });

  it("shows the mode toggle by default (dual-mode is always on)", () => {
    render(<LoginForm onSuccess={vi.fn()} />, { wrapper: TestProviders });
    expect(
      screen.getByRole("button", { name: /go to sico\.dev/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });
});

describe("<LoginForm> dual-mode (SICO ⇄ SICO.Dev)", () => {
  beforeEach(() => {
    capturedOptions = null;
    mockedUseLogin.mockReset();
    mockedUseLogin.mockImplementation((options) => {
      capturedOptions = options;
      return mockLoginReturn();
    });
  });

  it("renders the toggle and switches title/subtitle operator ⇄ developer", async () => {
    const user = userEvent.setup();
    render(<LoginForm onSuccess={vi.fn()} />, { wrapper: TestProviders });
    // Operator first.
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /go to sico\.dev/i });
    await user.click(toggle);
    // Developer after the exit→swap completes (the form plays an exit
    // animation, then swaps copy — so the new heading appears async).
    expect(
      await screen.findByRole("heading", { name: "Welcome to SICO.Dev" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Build and manage Digital Workers."),
    ).toBeInTheDocument();
    // Toggle now offers the way back.
    screen.getByRole("button", { name: /go to sico$/i });
  });

  it("reports the active mode to onSuccess (developer after toggle)", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />, { wrapper: TestProviders });
    await user.click(screen.getByRole("button", { name: /go to sico\.dev/i }));
    // Wait for the exit→swap to settle into the developer view before
    // submitting, so the submit genuinely happens under developer mode.
    await screen.findByRole("heading", { name: "Welcome to SICO.Dev" });
    await user.click(screen.getByRole("button", { name: /continue/i }));
    const payload = {
      tokenInfo: { accessToken: "tok", expiresAt: 1_900_000_000 },
      user: {
        id: 1,
        email: "dev@b.co",
        roles: [
          {
            id: 1,
            roleCode: "project_admin",
            scopeType: "project",
            scopeId: 1,
          },
        ],
      },
    };
    capturedOptions!.onSuccess(payload);
    expect(onSuccess).toHaveBeenCalledWith(payload, "developer");
  });

  it("reports the SUBMITTED mode, not a mode toggled while the request is in flight", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />, { wrapper: TestProviders });
    // Submit under developer, then toggle back to operator before the
    // mutation resolves — onSuccess must still route by the submitted mode.
    await user.click(screen.getByRole("button", { name: /go to sico\.dev/i }));
    await screen.findByRole("heading", { name: "Welcome to SICO.Dev" });
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /go to sico$/i }));
    const payload = {
      tokenInfo: { accessToken: "tok", expiresAt: 1_900_000_000 },
      user: {
        id: 1,
        email: "dev@b.co",
        roles: [
          {
            id: 1,
            roleCode: "project_admin",
            scopeType: "project",
            scopeId: 1,
          },
        ],
      },
    };
    capturedOptions!.onSuccess(payload);
    expect(onSuccess).toHaveBeenCalledWith(payload, "developer");
  });
});
