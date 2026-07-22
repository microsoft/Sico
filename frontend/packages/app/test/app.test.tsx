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
