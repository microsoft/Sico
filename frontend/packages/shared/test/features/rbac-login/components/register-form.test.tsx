import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { JSX, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RegisterForm } from "@/features/rbac-login/components/register-form";
import { useRegister } from "@/features/rbac-login/hooks/use-register";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/rbac-login/hooks/use-register", () => ({
  useRegister: vi.fn(),
}));

const mockedUseRegister = vi.mocked(useRegister);
const apiClient = axios.create({ baseURL: "/api/sico" });

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

type Options = Parameters<typeof useRegister>[0];

let capturedOptions: Options | null = null;
const mutate = vi.fn();

function mockRegisterReturn(
  overrides: Partial<ReturnType<typeof useRegister>> = {},
): ReturnType<typeof useRegister> {
  return {
    mutate,
    isPending: false,
    ...overrides,
  };
}

async function fillValidRegistration(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByLabelText(/email/i), "person@example.com");
  await user.type(screen.getByLabelText("Password*"), "password1");
}

describe("<RegisterForm>", () => {
  beforeEach(() => {
    capturedOptions = null;
    mutate.mockReset();
    mockedUseRegister.mockReset();
    mockedUseRegister.mockImplementation((options) => {
      capturedOptions = options;
      return mockRegisterReturn();
    });
  });

  it("renders the Operator registration copy and field presentation", () => {
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });

    expect(screen.getByRole("heading", { name: "Sign up" })).toBeVisible();
    expect(screen.getByText("Your Digital Workforce Platform.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create Account" }),
    ).toBeEnabled();
    expect(screen.getByText("Already have an account?")).toHaveClass(
      "inline-flex",
      "gap-3",
    );
    expect(
      screen.getByRole("button", { name: "Go to SICO.Dev" }).parentElement,
    ).toHaveClass("flex", "flex-col", "gap-20");
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass(
      "text-button-link-foreground-rest",
      "hover:text-button-link-foreground-hover",
      "active:text-button-link-foreground-pressed",
    );
    expect(screen.getByPlaceholderText("Enter email address")).toHaveAttribute(
      "id",
      "register-email",
    );
    expect(screen.getByPlaceholderText("Create password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByPlaceholderText("Create password")).toHaveAttribute(
      "id",
      "register-password",
    );
  });

  it("keeps an empty blur quiet", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });

    await user.click(screen.getByLabelText(/email/i));
    await user.tab();

    expect(screen.queryByText("Please enter your email")).toBeNull();
  });

  it("validates a non-empty invalid email on blur", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });

    await user.type(screen.getByLabelText(/email/i), "invalid");
    await user.tab();

    expect(await screen.findByText("Please enter a valid email")).toBeVisible();
  });

  it("shows the exact minimum-password error", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });

    await user.type(screen.getByLabelText("Password*"), "short");
    await user.tab();

    expect(
      await screen.findByText("Password must be at least 8 characters"),
    ).toBeVisible();
  });

  it("retains password visibility and Caps Lock behavior", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });
    const password = screen.getByLabelText("Password*");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    password.focus();
    await user.keyboard("{CapsLock}A");

    expect(screen.getByText("Caps Lock is on")).toBeVisible();
  });

  it("disables Create Account without changing its text while pending", () => {
    mockedUseRegister.mockImplementation((options) => {
      capturedOptions = options;
      return mockRegisterReturn({ isPending: true });
    });
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });

    expect(
      screen.getByRole("button", { name: "Create Account" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Create Account" }),
    ).toBeDisabled();
  });

  it("shows fixed rejected copy — never the raw backend message — and clears on edit", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });
    await fillValidRegistration(user);
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    // The rejected path carries no backend string — the UI owns the copy.
    capturedOptions!.onRejectedError();
    expect(
      await screen.findByText(
        "We couldn't create your account. Check your details and try again.",
      ),
    ).toBeVisible();

    await user.type(screen.getByLabelText(/email/i), "x");
    expect(
      screen.queryByText(
        "We couldn't create your account. Check your details and try again.",
      ),
    ).toBeNull();
  });

  it("shows the exact network registration error", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });
    await fillValidRegistration(user);
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    capturedOptions!.onNetworkError();

    expect(
      await screen.findByText(
        "Couldn't reach the server. Please check your connection and try again.",
      ),
    ).toBeVisible();
  });

  it("submits only email and password and reports the submitted mode snapshot", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<RegisterForm onSuccess={onSuccess} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });
    await user.click(screen.getByRole("button", { name: "Go to SICO.Dev" }));
    await screen.findByRole("heading", { name: "Welcome to SICO.Dev" });
    await fillValidRegistration(user);
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    await user.click(screen.getByRole("button", { name: "Go to SICO" }));

    expect(mutate).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "password1",
    });
    const payload = { id: "user-1" };
    capturedOptions!.onSuccess(payload);
    expect(onSuccess).toHaveBeenCalledWith(payload, "developer");
  });

  it("reports the active mode from Sign in", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(<RegisterForm onSuccess={vi.fn()} onLogin={onLogin} />, {
      wrapper: TestProviders,
    });

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onLogin).toHaveBeenLastCalledWith("operator");

    await user.click(screen.getByRole("button", { name: "Go to SICO.Dev" }));
    await screen.findByRole("heading", { name: "Welcome to SICO.Dev" });
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onLogin).toHaveBeenLastCalledWith("developer");
  });

  it("switches between the Operator and Developer registration copy", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSuccess={vi.fn()} onLogin={vi.fn()} />, {
      wrapper: TestProviders,
    });

    await user.click(screen.getByRole("button", { name: "Go to SICO.Dev" }));

    expect(
      await screen.findByRole("heading", { name: "Welcome to SICO.Dev" }),
    ).toBeVisible();
    expect(screen.getByText("Build and manage Digital Workers.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Go to SICO" })).toBeVisible();
  });
});
