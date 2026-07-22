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
