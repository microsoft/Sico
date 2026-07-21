import { render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userModeAtom } from "@/atoms/user-mode-atom";

const mockNavigate = vi.fn();
const mockUseMatches = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useMatches: () => mockUseMatches(),
}));

const { ModeGuard } =
  await import("@/features/rbac-login/mode-guard/mode-guard");

function withMode(
  ui: ReactElement,
  mode: "operator" | "developer",
): ReactElement {
  const store = createStore();
  store.set(userModeAtom, mode);
  return <Provider store={store}>{ui}</Provider>;
}

const child = <div data-testid="guarded">content</div>;

function matches(modes: readonly ("operator" | "developer")[] | undefined): {
  staticData: { modes?: readonly ("operator" | "developer")[] };
}[] {
  return [{ staticData: {} }, { staticData: modes ? { modes } : {} }];
}

beforeEach(() => {
  mockNavigate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("<ModeGuard>", () => {
  it("renders children on a shared route", () => {
    mockUseMatches.mockReturnValue(matches(undefined));
    render(withMode(<ModeGuard>{child}</ModeGuard>, "operator"));
    expect(screen.getByTestId("guarded")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders children when the mode is allowed", () => {
    mockUseMatches.mockReturnValue(matches(["operator"]));
    render(withMode(<ModeGuard>{child}</ModeGuard>, "operator"));
    expect(screen.getByTestId("guarded")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("redirects an operator off a developer-only route and renders nothing", async () => {
    mockUseMatches.mockReturnValue(matches(["developer"]));
    render(withMode(<ModeGuard>{child}</ModeGuard>, "operator"));
    expect(screen.queryByTestId("guarded")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/digital-worker",
        replace: true,
      });
    });
  });

  it("redirects a developer off an operator-only route to the studio", async () => {
    mockUseMatches.mockReturnValue(matches(["operator"]));
    render(withMode(<ModeGuard>{child}</ModeGuard>, "developer"));
    expect(screen.queryByTestId("guarded")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/studio",
        replace: true,
      });
    });
  });
});
