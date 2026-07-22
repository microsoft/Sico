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

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../src/components/ui/dialog";

afterEach(cleanup);

type RenderOptions = {
  showCloseButton?: boolean;
  variant?: "confirmation" | "content";
  defaultOpen?: boolean;
};

function renderDialog({
  showCloseButton = true,
  variant,
  defaultOpen = false,
}: RenderOptions = {}): void {
  render(
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent showCloseButton={showCloseButton} variant={variant}>
        <DialogHeader>
          <DialogTitle>Test title</DialogTitle>
          <DialogDescription>Test description</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog", () => {
  it("renders trigger", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  describe("variants", () => {
    it("variant=confirmation → max-h-60 w-150", async () => {
      renderDialog({ variant: "confirmation", defaultOpen: true });
      expect(await screen.findByRole("dialog")).toHaveClass(
        "max-h-60",
        "w-150",
      );
    });

    it("variant=content → max-h-160 max-w-240 min-w-110", async () => {
      renderDialog({ variant: "content", defaultOpen: true });
      expect(await screen.findByRole("dialog")).toHaveClass(
        "max-h-160",
        "max-w-240",
        "min-w-110",
      );
    });
  });

  describe("showCloseButton", () => {
    it("renders the close button by default", async () => {
      renderDialog({ defaultOpen: true });
      await screen.findByRole("dialog");
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("hides the close button when showCloseButton is false", async () => {
      renderDialog({ showCloseButton: false, defaultOpen: true });
      await screen.findByRole("dialog");
      expect(
        screen.queryByRole("button", { name: "Close" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("DialogFooter", () => {
    // DialogContent's top-right X is also named "Close", so disable it to
    // isolate the footer's own close button.
    function renderFooter(footerShowClose: boolean): void {
      render(
        <Dialog defaultOpen>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Test title</DialogTitle>
              <DialogDescription>Test description</DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton={footerShowClose} />
          </DialogContent>
        </Dialog>,
      );
    }

    it("renders a footer close button when showCloseButton is true", async () => {
      renderFooter(true);
      await screen.findByRole("dialog");
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("omits the footer close button by default", async () => {
      renderFooter(false);
      await screen.findByRole("dialog");
      expect(
        screen.queryByRole("button", { name: "Close" }),
      ).not.toBeInTheDocument();
    });

    it("lets a consumer className override the default sm:justify-end", async () => {
      render(
        <Dialog defaultOpen>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Test title</DialogTitle>
              <DialogDescription>Test description</DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-between">
              <DialogClose>Cancel</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>,
      );
      await screen.findByRole("dialog");
      // The footer is a styling wrapper with no role — reach it via its button.
      const footer = screen.getByRole("button", {
        name: "Cancel",
      }).parentElement;
      expect(footer).toHaveClass("sm:justify-between");
      // Same justify-content scope, so tailwind-merge drops the default.
      expect(footer).not.toHaveClass("sm:justify-end");
    });
  });
});
