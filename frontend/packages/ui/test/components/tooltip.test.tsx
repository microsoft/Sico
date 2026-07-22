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

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ─── Helper ─────────────────────────────────────────────────── */

type RenderOptions = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  showArrow?: boolean;
  contentClassName?: string;
  triggerClassName?: string;
};

function renderTooltip({
  open,
  defaultOpen,
  onOpenChange,
  delayDuration,
  showArrow,
  contentClassName,
  triggerClassName,
}: RenderOptions = {}): void {
  render(
    <TooltipProvider>
      <Tooltip
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        delayDuration={delayDuration}
      >
        <TooltipTrigger className={triggerClassName}>hover me</TooltipTrigger>
        <TooltipContent showArrow={showArrow} className={contentClassName}>
          Tooltip text
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
}

/* ─── Tests ──────────────────────────────────────────────────── */

describe("Tooltip", () => {
  it("hides content by default", () => {
    renderTooltip();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  describe("focus and blur", () => {
    it("shows content on trigger focus", async () => {
      const user = userEvent.setup();
      renderTooltip();
      await user.tab();
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });

    it("hides content when trigger loses focus", async () => {
      const user = userEvent.setup();
      renderTooltip();
      await user.tab();
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      await user.tab();
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("shows tooltip text on focus", async () => {
      const user = userEvent.setup();
      renderTooltip();
      await user.tab();
      expect(screen.getByRole("tooltip")).toHaveTextContent("Tooltip text");
    });
  });

  describe("hover", () => {
    it("shows content after mouseenter delay elapses", async () => {
      const user = userEvent.setup();
      renderTooltip({ delayDuration: 0 });
      await user.hover(screen.getByRole("button", { name: /hover me/i }));
      expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    });

    it("does not show content before delay elapses", async () => {
      const user = userEvent.setup();
      // Very long delay — content must not be visible immediately after hover
      renderTooltip({ delayDuration: 10_000 });
      await user.hover(screen.getByRole("button", { name: /hover me/i }));
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("hides content on mouseleave", async () => {
      const user = userEvent.setup();
      renderTooltip({ delayDuration: 0 });
      const trigger = screen.getByRole("button", { name: /hover me/i });
      await user.hover(trigger);
      await screen.findByRole("tooltip");
      await user.unhover(trigger);
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });

  describe("controlled open", () => {
    it("shows content immediately when open=true", () => {
      renderTooltip({ open: true });
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });

    it("hides content when open=false", () => {
      renderTooltip({ open: false });
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("calls onOpenChange(true) on trigger focus", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      renderTooltip({ onOpenChange: handleChange });
      await user.tab();
      expect(handleChange).toHaveBeenCalledWith(true);
    });

    it("calls onOpenChange(false) on trigger blur", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      renderTooltip({ onOpenChange: handleChange });
      await user.tab();
      await user.tab();
      expect(handleChange).toHaveBeenCalledWith(false);
    });
  });

  describe("TooltipProvider delayDuration", () => {
    it("uses provider delay when no local delay is set", async () => {
      const user = userEvent.setup();
      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger>trigger</TooltipTrigger>
            <TooltipContent>content</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
      await user.hover(screen.getByRole("button", { name: /trigger/i }));
      expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    });
  });

  describe("showArrow", () => {
    it("renders the arrow element when showArrow=true (default)", async () => {
      const user = userEvent.setup();
      renderTooltip();
      await user.tab();
      const tooltip = screen.getByRole("tooltip");
      expect(
        tooltip.querySelector("[data-slot='tooltip-arrow']"),
      ).toBeInTheDocument();
    });

    it("does not render the arrow element when showArrow=false", async () => {
      const user = userEvent.setup();
      renderTooltip({ showArrow: false });
      await user.tab();
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip.querySelector("[data-slot='tooltip-arrow']")).toBeNull();
    });
  });

  describe("trigger", () => {
    it("renders as a button with correct role", () => {
      renderTooltip();
      expect(
        screen.getByRole("button", { name: /hover me/i }),
      ).toBeInTheDocument();
    });

    it("forwards data and aria attributes to trigger", () => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger data-testid="tip-trigger" aria-label="show info">
              trigger
            </TooltipTrigger>
            <TooltipContent>info</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
      const trigger = screen.getByRole("button", { name: /show info/i });
      expect(trigger).toHaveAttribute("data-testid", "tip-trigger");
      expect(trigger).toHaveAttribute("aria-label", "show info");
    });

    it("merges custom className on trigger", () => {
      renderTooltip({ triggerClassName: "custom-trigger" });
      expect(screen.getByRole("button")).toHaveClass("custom-trigger");
    });
  });

  describe("content", () => {
    it("merges custom className on content", async () => {
      const user = userEvent.setup();
      renderTooltip({ contentClassName: "custom-content" });
      await user.tab();
      expect(screen.getByRole("tooltip")).toHaveClass("custom-content");
    });
  });

  // The positioner is the element that participates in page-level stacking (the
  // popup's own `z-50` only orders inside the positioner's isolated context). It
  // must carry a z-index or a fixed-overlay sibling (a maximized sidepane at
  // `z-50`) covers the tooltip. Mirrors PopoverContent's positioner.
  describe("stacking (positioner z-index)", () => {
    it("puts z-50 on the positioner so a fixed overlay can't cover it", () => {
      renderTooltip({ open: true });
      const positioner = screen.getByRole("tooltip").parentElement;
      expect(positioner).toHaveClass("z-50");
    });
  });
});
