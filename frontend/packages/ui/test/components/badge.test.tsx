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

import { Badge } from "../../src/components/ui/badge";

describe("Badge", () => {
  describe("default variant", () => {
    it("renders pill with background for green", () => {
      render(
        <Badge variant="default" color="green">
          Completed
        </Badge>,
      );
      const badge = screen.getByText("Completed").closest("span");
      expect(badge).toHaveClass("bg-status-success-fill");
      expect(badge).toHaveClass("text-status-success-on-fill-foreground");
      expect(badge).toHaveClass("rounded-sm");
    });

    it("renders pill with background for red", () => {
      render(
        <Badge variant="default" color="red">
          Failed
        </Badge>,
      );
      const badge = screen.getByText("Failed").closest("span");
      expect(badge).toHaveClass("bg-status-error-fill");
      expect(badge).toHaveClass("text-status-error-on-fill-foreground");
    });

    it("renders pill with background for orange", () => {
      render(
        <Badge variant="default" color="orange">
          Warning
        </Badge>,
      );
      const badge = screen.getByText("Warning").closest("span");
      expect(badge).toHaveClass("bg-status-warning-fill");
      expect(badge).toHaveClass("text-status-warning-foreground");
    });

    it("renders pill with background for blue", () => {
      render(
        <Badge variant="default" color="blue">
          Running
        </Badge>,
      );
      const badge = screen.getByText("Running").closest("span");
      expect(badge).toHaveClass("bg-status-info-fill");
      expect(badge).toHaveClass("text-status-info-on-fill-foreground");
    });

    it("renders pill with background for gray", () => {
      render(
        <Badge variant="default" color="gray">
          Inactive
        </Badge>,
      );
      const badge = screen.getByText("Inactive").closest("span");
      expect(badge).toHaveClass("bg-surface-sunken");
      expect(badge).toHaveClass("text-foreground-secondary");
    });

    it("applies structural classes (h-6, rounded-sm)", () => {
      render(
        <Badge variant="default" color="green">
          Pill
        </Badge>,
      );
      const badge = screen.getByText("Pill").closest("span");
      expect(badge).toHaveClass("h-6");
      expect(badge).toHaveClass("rounded-sm");
    });
  });

  describe("secondary variant", () => {
    it("renders text-only for green", () => {
      render(
        <Badge variant="secondary" color="green">
          Active
        </Badge>,
      );
      const badge = screen.getByText("Active").closest("span");
      expect(badge).toHaveClass("text-status-success-foreground");
    });

    it("renders text-only for red", () => {
      render(
        <Badge variant="secondary" color="red">
          Failed
        </Badge>,
      );
      const badge = screen.getByText("Failed").closest("span");
      expect(badge).toHaveClass("text-status-error-foreground");
    });

    it("renders text-only for orange", () => {
      render(
        <Badge variant="secondary" color="orange">
          Warning
        </Badge>,
      );
      const badge = screen.getByText("Warning").closest("span");
      expect(badge).toHaveClass("text-status-warning-foreground");
    });

    it("renders text-only for blue", () => {
      render(
        <Badge variant="secondary" color="blue">
          Running
        </Badge>,
      );
      const badge = screen.getByText("Running").closest("span");
      expect(badge).toHaveClass("text-status-info-foreground");
    });

    it("renders text-only for gray", () => {
      render(
        <Badge variant="secondary" color="gray">
          Offline
        </Badge>,
      );
      const badge = screen.getByText("Offline").closest("span");
      expect(badge).toHaveClass("text-foreground-tertiary");
    });

    it("applies text-only structural class (h-5)", () => {
      render(
        <Badge variant="secondary" color="green">
          Compact
        </Badge>,
      );
      const badge = screen.getByText("Compact").closest("span");
      expect(badge).toHaveClass("h-5");
    });
  });

  describe("custom className", () => {
    it("merges custom className", () => {
      render(
        <Badge variant="secondary" color="gray" className="mt-4">
          Inactive
        </Badge>,
      );
      const badge = screen.getByText("Inactive").closest("span");
      expect(badge).toHaveClass("mt-4");
    });
  });

  describe("data-slot", () => {
    it("emits data-slot='badge'", () => {
      render(<Badge color="green">Active</Badge>);
      const badge = screen.getByText("Active").closest("span");
      expect(badge).toHaveAttribute("data-slot", "badge");
    });
  });
});
