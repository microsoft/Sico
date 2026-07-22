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
import { afterEach, describe, expect, it } from "vitest";

// Import the SICO-wrapped `toast` (not sonner's raw one) so these tests
// exercise the real invert→toasterId routing.
import { toast, Toaster } from "@/components/ui/sonner";

/* ─── Helper ─────────────────────────────────────────────────────────
   Sonner renders each toast as a portaled `<li data-sonner-toast>` with
   no per-toast ARIA role (only the `<ol>` is a labeled region), so the
   text is the semantic handle and the styled element is its
   `data-sonner-toast` ancestor. Toasts are fired through the public
   `toast.*` API — no DOM interaction needed — and awaited via findBy. */

async function fireAndGetToast(
  fire: () => void,
  text: RegExp,
): Promise<HTMLElement> {
  render(<Toaster />);
  fire();
  const textNode = await screen.findByText(text);
  const toastEl = textNode.closest("[data-sonner-toast]");
  if (!(toastEl instanceof HTMLElement)) {
    throw new Error("toast element not found");
  }
  return toastEl;
}

afterEach(() => {
  // Toasts are global state — clear the queue between tests.
  toast.dismiss();
});

describe("Toaster", () => {
  it("mounts both toast surfaces (white bottom-right, black bottom-center)", async () => {
    render(<Toaster />);
    // Two labeled regions = two surfaces. sonner only renders each surface's
    // positioned `<ol>` once it holds a toast, so fire one into each.
    expect(
      screen.getAllByRole("region", { name: /notifications/i }),
    ).toHaveLength(2);
    toast.success("w-mount");
    toast.success("b-mount", { invert: true });
    const white = (await screen.findByText(/w-mount/i)).closest(
      "[data-sonner-toaster]",
    );
    const black = (await screen.findByText(/b-mount/i)).closest(
      "[data-sonner-toaster]",
    );
    expect(white).toHaveAttribute("data-x-position", "right");
    expect(black).toHaveAttribute("data-x-position", "center");
  });

  describe("white surface — per-kind fill", () => {
    // The whole TOAST_CLASSNAME string lands on every toast; the actual
    // per-kind selection happens at CSS runtime off `data-type` (which jsdom
    // doesn't evaluate). So each test asserts BOTH that the gated token is
    // wired in AND that sonner stamped the discriminating `data-type` — the
    // two together prove the fill is reachable for that kind.
    it("default (bare toast) → ungated bg-surface-basic, no data-type", async () => {
      const el = await fireAndGetToast(
        () => toast("default copy"),
        /default copy/i,
      );
      expect(el).not.toHaveAttribute("data-type");
      expect(el).toHaveClass("not-data-[invert=true]:bg-surface-basic");
    });

    it("info → data-type=info on the ungated white fill (no warm tint)", async () => {
      const el = await fireAndGetToast(
        () => toast.info("info copy"),
        /info copy/i,
      );
      expect(el).toHaveAttribute("data-type", "info");
      // Info stays on the plain white base — its blue glyph pairs with white,
      // not the warm warning tint (per design review).
      expect(el).toHaveClass("not-data-[invert=true]:bg-surface-basic");
      // Guard the design decision: info must NOT carry the warning tint gate.
      expect(el).not.toHaveClass(
        "not-data-[invert=true]:data-[type=info]:bg-status-warning-subtle-fill",
      );
    });

    it("warning → data-type=warning + status-warning-subtle-fill gate", async () => {
      const el = await fireAndGetToast(
        () => toast.warning("warning copy"),
        /warning copy/i,
      );
      expect(el).toHaveAttribute("data-type", "warning");
      expect(el).toHaveClass(
        "not-data-[invert=true]:data-[type=warning]:bg-status-warning-subtle-fill",
      );
    });

    it("error → data-type=error + status-error-subtle-fill gate", async () => {
      const el = await fireAndGetToast(
        () => toast.error("error copy"),
        /error copy/i,
      );
      expect(el).toHaveAttribute("data-type", "error");
      expect(el).toHaveClass(
        "not-data-[invert=true]:data-[type=error]:bg-status-error-subtle-fill",
      );
    });

    it("success → data-type=success on the ungated white fill", async () => {
      const el = await fireAndGetToast(
        () => toast.success("success copy"),
        /success copy/i,
      );
      expect(el).toHaveAttribute("data-type", "success");
      expect(el).toHaveClass("not-data-[invert=true]:bg-surface-basic");
    });

    it("loading → data-type=loading + toast-loading-bar gate", async () => {
      const el = await fireAndGetToast(
        () => toast.loading("loading copy"),
        /loading copy/i,
      );
      expect(el).toHaveAttribute("data-type", "loading");
      expect(el).toHaveClass(
        "not-data-[invert=true]:data-[type=loading]:toast-loading-bar",
      );
    });
  });

  describe("white surface — chrome", () => {
    it("carries the card border + shadow", async () => {
      const el = await fireAndGetToast(
        () => toast.info("chrome copy"),
        /chrome copy/i,
      );
      expect(el).toHaveClass(
        "not-data-[invert=true]:border-stroke-subtle-card-rest",
        "shadow-l",
      );
    });

    it("pins the fixed 320x64 footprint", async () => {
      // `h-16!` beats sonner's hover-expansion `height:var(--initial-height)`
      // (0,3,0) so the toast doesn't resize on pointer enter; `w-80` locks width.
      const el = await fireAndGetToast(
        () => toast.info("footprint copy"),
        /footprint copy/i,
      );
      expect(el).toHaveClass("h-16!", "w-80");
    });

    it("renders the View action with the subtle-button hover token", async () => {
      render(<Toaster />);
      toast.error("with action", {
        action: { label: "View", onClick: () => {} },
      });
      const action = await screen.findByRole("button", { name: /view/i });
      expect(action).toHaveClass("hover:bg-button-subtle-fill-hover");
    });

    it("renders the close button (opt-in) at the trailing edge with the muted-icon token", async () => {
      // Sonner suppresses the close X on `loading` toasts, so use `error`.
      render(<Toaster />);
      toast.error("with close", { closeButton: true });
      const close = await screen.findByRole("button", { name: /close toast/i });
      // Pulled out of sonner's absolute top-corner into the inline trailing slot.
      expect(close).toHaveClass(
        "order-last",
        "static!",
        "text-foreground-secondary",
      );
    });

    it("hides the close X when an action shares the trailing slot", async () => {
      // Design: the View action and the close X are mutually exclusive —
      // the toast slot carries the has-action→hide-close rule.
      const el = await fireAndGetToast(
        () =>
          toast.error("action wins", {
            closeButton: true,
            action: { label: "View", onClick: () => {} },
          }),
        /action wins/i,
      );
      expect(el).toHaveClass(
        "[&:has([data-button])_[data-close-button]]:hidden",
      );
    });
  });

  describe("black surface — invert: true", () => {
    it("stamps data-invert=true", async () => {
      const el = await fireAndGetToast(
        () => toast.success("inv success", { invert: true }),
        /inv success/i,
      );
      expect(el).toHaveAttribute("data-invert", "true");
    });

    it("uses the inverted fill + foreground", async () => {
      const el = await fireAndGetToast(
        () => toast.success("inv fill", { invert: true }),
        /inv fill/i,
      );
      expect(el).toHaveClass(
        "data-[invert=true]:bg-surface-inverted",
        "data-[invert=true]:text-foreground-on-inverted",
      );
    });

    it("collapses to the tighter hug footprint", async () => {
      const el = await fireAndGetToast(
        () => toast("inv plain", { invert: true }),
        /inv plain/i,
      );
      expect(el).toHaveClass(
        // `h-auto!` cancels the shared fixed `h-16!` — a regression dropping
        // it strands black toasts at 64px, so it must be pinned here.
        "data-[invert=true]:h-auto!",
        "data-[invert=true]:min-h-10",
        "data-[invert=true]:w-auto",
        "data-[invert=true]:max-w-60",
        "data-[invert=true]:rounded-lg",
      );
    });

    // Icons on the black surface use mid-tone status tokens tuned for dark
    // backgrounds. The overrides gate on data-invert + data-type, both stamped
    // by sonner on the same toast <li> this suite already handles.
    it("success → mid-tone success icon override", async () => {
      const el = await fireAndGetToast(
        () => toast.success("inv icon success", { invert: true }),
        /inv icon success/i,
      );
      expect(el).toHaveAttribute("data-type", "success");
      expect(el).toHaveClass(
        "data-[invert=true]:data-[type=success]:[&_[data-icon]>svg]:text-status-success-on-inverted-foreground",
      );
    });

    it("warning → mid-tone warning icon override", async () => {
      const el = await fireAndGetToast(
        () => toast.warning("inv icon warning", { invert: true }),
        /inv icon warning/i,
      );
      expect(el).toHaveAttribute("data-type", "warning");
      expect(el).toHaveClass(
        "data-[invert=true]:data-[type=warning]:[&_[data-icon]>svg]:text-status-warning-on-inverted-foreground",
      );
    });

    it("error → mid-tone error icon override", async () => {
      const el = await fireAndGetToast(
        () => toast.error("inv icon error", { invert: true }),
        /inv icon error/i,
      );
      expect(el).toHaveAttribute("data-type", "error");
      expect(el).toHaveClass(
        "data-[invert=true]:data-[type=error]:[&_[data-icon]>svg]:text-status-error-on-inverted-foreground",
      );
    });
  });

  describe("surface routing — invert picks the toaster", () => {
    // The SICO `toast` wrapper injects `toasterId: "inverted"` when
    // `invert: true`, so a black toast renders in the bottom-center toaster
    // and a white toast in the bottom-right one — the single `invert` flag
    // drives both styling and placement.
    const toasterOf = (el: HTMLElement): Element | null =>
      el.closest("[data-sonner-toaster]");

    it("a plain toast lands in the white (bottom-right) surface", async () => {
      const el = await fireAndGetToast(
        () => toast.success("white routed"),
        /white routed/i,
      );
      expect(toasterOf(el)).toHaveAttribute("data-x-position", "right");
      expect(toasterOf(el)).toHaveAttribute("data-y-position", "bottom");
    });

    it("an invert:true toast lands in the black (bottom-center) surface", async () => {
      const el = await fireAndGetToast(
        () => toast.error("black routed", { invert: true }),
        /black routed/i,
      );
      expect(toasterOf(el)).toHaveAttribute("data-x-position", "center");
      expect(toasterOf(el)).toHaveAttribute("data-y-position", "bottom");
    });

    it("keeps the two surfaces' toasts in separate toasters", async () => {
      render(<Toaster />);
      toast.success("w-split");
      toast.success("b-split", { invert: true });
      const white = (await screen.findByText(/w-split/i)).closest(
        "[data-sonner-toaster]",
      );
      const black = (await screen.findByText(/b-split/i)).closest(
        "[data-sonner-toaster]",
      );
      expect(white).not.toBe(black);
    });
  });
});
