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
import { describe, expect, it, vi } from "vitest";

import { Textarea } from "@/components/ui/textarea";

describe("Textarea", () => {
  it("renders with textbox role", (): void => {
    render(<Textarea placeholder="Bio" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders with data-slot=textarea", (): void => {
    render(<Textarea placeholder="Bio" />);
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "data-slot",
      "textarea",
    );
  });

  it("applies field-sizing-content for auto-grow", (): void => {
    render(<Textarea placeholder="Bio" />);
    expect(screen.getByRole("textbox")).toHaveClass("field-sizing-content");
  });

  describe("disabled state", () => {
    it("applies disabled attribute", (): void => {
      render(<Textarea disabled placeholder="Disabled" />);
      expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("does not call onChange when disabled", async (): Promise<void> => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Textarea disabled onChange={handleChange} placeholder="Test" />);
      await user.type(screen.getByRole("textbox"), "x");
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe("invalid state", () => {
    it("reflects aria-invalid", (): void => {
      render(<Textarea aria-invalid="true" placeholder="Bio" />);
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
  });

  describe("controlled value", () => {
    it("reflects controlled value", (): void => {
      render(
        <Textarea value="controlled" onChange={vi.fn()} placeholder="Test" />,
      );
      expect(screen.getByRole("textbox")).toHaveValue("controlled");
    });

    it("calls onChange when typing", async (): Promise<void> => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Textarea value="" onChange={handleChange} placeholder="Test" />);
      await user.type(screen.getByRole("textbox"), "a");
      expect(handleChange).toHaveBeenCalled();
    });
  });

  it("merges custom className", (): void => {
    render(<Textarea className="mt-4" placeholder="Test" />);
    expect(screen.getByRole("textbox")).toHaveClass("mt-4");
  });

  it("forwards native textarea attributes", (): void => {
    render(
      <Textarea
        data-testid="bio"
        aria-label="biography"
        id="bio-input"
        name="bio"
        maxLength={500}
        placeholder="Bio"
      />,
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("data-testid", "bio");
    expect(textarea).toHaveAttribute("aria-label", "biography");
    expect(textarea).toHaveAttribute("id", "bio-input");
    expect(textarea).toHaveAttribute("name", "bio");
    expect(textarea).toHaveAttribute("maxLength", "500");
  });
});
