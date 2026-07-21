import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "react-error-boundary";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorView } from "@/components/error-view";

// `ErrorView` is an ErrorBoundary fallback. The monorepo logger sinks to
// `console.error` (see utils/logger.ts), so we assert against a console
// spy rather than mocking the logger module.
function Boom(): never {
  throw new Error("kaboom");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<ErrorView> logging", () => {
  it("logs the caught error exactly once", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary FallbackComponent={ErrorView}>
        <Boom />
      </ErrorBoundary>,
    );

    // The fallback rendered (sanity) ...
    screen.getByRole("alert");

    // ... and our logger.error fired for the caught error. React itself
    // also logs error-boundary warnings to console.error, so filter to
    // the ErrorView log line by its message prefix.
    const ourLogs = spy.mock.calls.filter(
      (args) => args[0] === "ErrorView caught",
    );
    expect(ourLogs).toHaveLength(1);
  });
});

describe("<ErrorView> centering", () => {
  it("self-centers via a fill wrapper on the alert role", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary FallbackComponent={ErrorView}>
        <Boom />
      </ErrorBoundary>,
    );

    // The `role="alert"` node is the fill+center wrapper itself, so features
    // mount ErrorView directly as the FallbackComponent — no per-feature
    // centering wrapper. `flex-1 min-h-0` covers in-card boundaries, `h-full`
    // covers full-page ones.
    expect(screen.getByRole("alert")).toHaveClass(
      "flex",
      "h-full",
      "min-h-0",
      "flex-1",
      "items-center",
      "justify-center",
    );
  });
});
