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
import userEvent from "@testing-library/user-event";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ErrorFallback,
  type ErrorFallbackProps,
  InnerErrorFallback,
  OuterErrorFallback,
  type OuterErrorFallbackProps,
} from "@/components/error-boundary/error-fallback";

describe("<ErrorFallback>", () => {
  it("renders error message + retry button", () => {
    render(
      <ErrorFallback
        error={new Error("boom")}
        resetErrorBoundary={() => {}}
        variant="inner"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /something went wrong/i,
    );
    screen.getByRole("button", { name: /retry/i });
  });
  it("calls resetErrorBoundary on retry click", async () => {
    const reset = vi.fn();
    render(
      <ErrorFallback
        error={new Error("boom")}
        resetErrorBoundary={reset}
        variant="inner"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(reset).toHaveBeenCalled();
  });
  it("logs and calls onReload on unrecoverable retry (outer)", async () => {
    const onReload = vi.fn();
    const resetErrorBoundary = vi.fn();
    render(
      <ErrorFallback
        error={new Error("boot")}
        resetErrorBoundary={resetErrorBoundary}
        variant="outer"
        onReload={onReload}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
  it('InnerErrorFallback binds variant="inner"', () => {
    render(
      <InnerErrorFallback
        error={new Error("boom")}
        resetErrorBoundary={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /something went wrong/i,
    );
    screen.getByRole("button", { name: /retry/i });
  });
  it('OuterErrorFallback binds variant="outer"', () => {
    render(<OuterErrorFallback error={new Error("boot")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /application failed to start/i,
    );
    screen.getByRole("button", { name: /reload/i });
  });

  // Chrome must use semantic tokens — raw `bg-white` / `text-gray-*` /
  // `border-gray-*` are foundation primitives reserved for designer
  // palette swaps.
  it("InnerErrorFallback uses semantic tokens for chrome (no raw bg-white / text-gray-*)", () => {
    render(
      <InnerErrorFallback
        error={new Error("boom")}
        resetErrorBoundary={() => {}}
      />,
    );
    const alert = screen.getByRole("alert");
    const containerClass = alert.className;
    expect(containerClass).not.toMatch(/\bbg-white\b/);
    expect(containerClass).not.toMatch(/\bborder-gray-\d+\b/);
    expect(containerClass).not.toMatch(/\btext-gray-\d+\b/);
    expect(containerClass).toMatch(
      /\b(bg-(?:background|card|surface-basic)|bg-button-secondary-fill-rest)\b/,
    );
  });

  // Pin the @sico/ui <Button> integration contract via `data-slot="button"`.
  it("InnerErrorFallback renders the @sico/ui <Button> primitive (data-slot=button)", () => {
    render(
      <InnerErrorFallback
        error={new Error("boom")}
        resetErrorBoundary={() => {}}
      />,
    );
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toHaveAttribute("data-slot", "button");
  });

  it("OuterErrorFallback renders the @sico/ui <Button> primitive (data-slot=button)", () => {
    render(<OuterErrorFallback error={new Error("boot")} />);
    const reload = screen.getByRole("button", { name: /reload/i });
    expect(reload).toHaveAttribute("data-slot", "button");
  });

  // `ErrorFallbackProps` is a discriminated union — `onReload` must NOT
  // appear on the inner branch. Pin so a future widening fails here.
  it("ErrorFallbackProps is a discriminated union on variant", () => {
    type InnerProps = Extract<ErrorFallbackProps, { variant: "inner" }>;
    type OuterProps = Extract<ErrorFallbackProps, { variant: "outer" }>;
    expectTypeOf<InnerProps>().not.toHaveProperty("onReload");
    expectTypeOf<OuterProps>().toHaveProperty("onReload");
    expectTypeOf<InnerProps>().toHaveProperty("error");
    expectTypeOf<InnerProps>().toHaveProperty("resetErrorBoundary");
    expectTypeOf<OuterProps>().toHaveProperty("error");
    expectTypeOf<OuterProps>().toHaveProperty("resetErrorBoundary");
  });

  // `<OuterErrorFallback>` recovers via `window.location.reload()`, so
  // `resetErrorBoundary` is omitted from its props — readding it would
  // introduce a misleading dead surface.
  it("OuterErrorFallbackProps omits resetErrorBoundary", () => {
    expectTypeOf<OuterErrorFallbackProps>().not.toHaveProperty(
      "resetErrorBoundary",
    );
    expectTypeOf<OuterErrorFallbackProps>().toHaveProperty("error");
    expectTypeOf<OuterErrorFallbackProps>().toHaveProperty("onReload");
  });
});
