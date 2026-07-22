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
import { describe, expect, it, vi } from "vitest";

import { Spinner } from "../../src/components/ui/spinner";

// `lottie-react` drives an SVG/rAF render loop jsdom can't run, and the loader
// is a third-party concern anyway. Mock it at the module seam: the real
// `loading.json` import still resolves — only the renderer is stubbed.
vi.mock("lottie-react", () => ({
  default: function LottieMock({
    loop,
    autoplay,
  }: {
    loop?: boolean;
    autoplay?: boolean;
  }) {
    return (
      <div
        data-testid="spinner-animation"
        data-loop={String(Boolean(loop))}
        data-autoplay={String(Boolean(autoplay))}
      />
    );
  },
}));

describe("Spinner", () => {
  it("renders with the status role and a default accessible label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });

  it("lets callers override the accessible label", () => {
    render(<Spinner aria-label="Loading more" />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Loading more",
    );
  });

  it("forwards className for layout while keeping the size locked at 40px", () => {
    render(<Spinner className="mt-4 size-4" />);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("mt-4");
    expect(el).toHaveClass("size-10");
    expect(el).not.toHaveClass("size-4");
  });

  it("renders the lg size variant at 64px and ignores className overrides", () => {
    render(<Spinner size="lg" className="size-4" />);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("size-16");
    expect(el).not.toHaveClass("size-10");
    expect(el).not.toHaveClass("size-4");
  });

  it("plays the loader animation on a continuous loop", () => {
    render(<Spinner />);
    const animation = screen.getByTestId("spinner-animation");
    expect(animation).toHaveAttribute("data-loop", "true");
    expect(animation).toHaveAttribute("data-autoplay", "true");
  });
});
