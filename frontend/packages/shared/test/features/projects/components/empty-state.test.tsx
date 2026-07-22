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
import { describe, expect, it } from "vitest";

import { EmptyState } from "../../../../src/features/projects/components/empty-state";

describe("EmptyState", () => {
  it("renders the empty illustration as decorative (alt='')", () => {
    render(<EmptyState />);
    const img = screen.getByTestId("message-state-illustration");
    expect(img).toHaveAttribute("alt", "");
  });

  it("renders heading and body copy verbatim", () => {
    render(<EmptyState />);
    screen.getByRole("heading", { name: "Nothing here yet" });
    screen.getByText("Projects hold your digital workers and their work.");
  });

  it("renders no create CTA", () => {
    render(<EmptyState />);
    expect(
      screen.queryByRole("button", { name: /create project/i }),
    ).not.toBeInTheDocument();
  });
});
