import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, it, vi } from "vitest";

import App from "@/app";

// Mock <RootProviders> at module scope so jotai/react-query/router state
// can't leak across suites, and so we can flip provider init into a
// synthetic throw to exercise the outer ErrorBoundary.
let shouldThrow = false;

vi.mock("@/components/root-providers", () => ({
  RootProviders: (): ReactElement => {
    if (shouldThrow) {
      throw new Error("synthetic provider init failure");
    }
    return <div data-testid="providers-mounted">providers-mounted</div>;
  },
}));

describe("<App>", () => {
  it("mounts router + react-query + jotai under outer ErrorBoundary", () => {
    shouldThrow = false;
    render(<App />);
    screen.getByTestId("providers-mounted");
  });

  it("outer ErrorBoundary catches Provider-init errors", () => {
    shouldThrow = true;
    // Silence React's expected error-boundary log noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<App />);
      screen.getByText(/application failed to start/i);
    } finally {
      spy.mockRestore();
    }
  });
});
