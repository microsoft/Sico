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

import { Checkbox } from "../../src/components/ui/checkbox";

describe("Checkbox", () => {
  it("renders with checkbox role", (): void => {
    render(<Checkbox />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("renders with data-slot attribute", (): void => {
    render(<Checkbox />);
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "data-slot",
      "checkbox",
    );
  });

  describe("state classes", () => {
    it("carries the rest border utility", (): void => {
      render(<Checkbox />);
      expect(screen.getByRole("checkbox")).toHaveClass(
        "border-input-stroke-rest",
      );
    });

    it("checked fill via data-checked: utilities", (): void => {
      render(<Checkbox defaultChecked />);
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toHaveClass("data-checked:bg-button-primary-fill-rest");
      expect(checkbox).toHaveClass(
        "data-checked:border-button-primary-fill-rest",
      );
      expect(checkbox).toHaveClass("data-checked:text-foreground-on-inverted");
    });

    it("disabled → disabled:opacity-50 utility", (): void => {
      render(<Checkbox disabled />);
      expect(screen.getByRole("checkbox")).toHaveClass("disabled:opacity-50");
    });

    it("aria-invalid → aria-invalid:border-input-stroke-error utility", (): void => {
      render(<Checkbox aria-invalid />);
      expect(screen.getByRole("checkbox")).toHaveClass(
        "aria-invalid:border-input-stroke-error",
      );
    });
  });
});
