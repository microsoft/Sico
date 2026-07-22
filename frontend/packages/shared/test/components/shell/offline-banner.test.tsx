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

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OfflineBanner } from "@/components/shell/offline-banner";

import { restoreOnline, setOnline } from "../../helpers/network";

describe("<OfflineBanner>", () => {
  afterEach(() => {
    restoreOnline();
  });

  // Live region must mount before content changes — NVDA/JAWS/VoiceOver
  // fire inconsistently when region+content mount together.
  it("renders the live region container even when online", () => {
    setOnline(true);
    render(<OfflineBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    // NBSP placeholder keeps the DOM node non-`:empty` so a future
    // `empty:hidden` rule can't accidentally hide it.
    expect(banner.textContent).toBe("\u00A0");
  });

  it("collapses to sr-only when online (not floating, still in a11y tree)", () => {
    setOnline(true);
    render(<OfflineBanner />);
    const banner = screen.getByRole("status");
    expect(banner.className).toMatch(/\bsr-only\b/);
    expect(banner.className).not.toMatch(/\bfixed\b/);
    expect(banner.className).not.toMatch(/\bz-50\b/);
    expect(banner.className).not.toMatch(/\bbg-status-warning-fill\b/);
  });

  // Regression-lock the `empty:hidden` bug: compiles to `display: none`,
  // which removes the region from the a11y tree.
  it("never compiles to display:none via empty:hidden when online", () => {
    setOnline(true);
    render(<OfflineBanner />);
    const banner = screen.getByRole("status");
    expect(banner.className).not.toMatch(/\bempty:hidden\b/);
    expect(window.getComputedStyle(banner).display).not.toBe("none");
  });

  it("populates the live region with the offline message when offline; clears on online event", () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    setOnline(true);
    fireEvent(window, new Event("online"));
    expect(screen.getByRole("status").textContent).toBe("\u00A0");
  });

  // Must consume semantic `bg-status-warning-fill` / `text-status-warning-foreground`,
  // not raw palette utilities — designer-driven theming depends on it.
  it("uses semantic status tokens when offline (no raw bg-yellow-100 / text-gray-*)", () => {
    setOnline(false);
    render(<OfflineBanner />);
    const banner = screen.getByRole("status");
    const cls = banner.className;
    expect(cls).not.toMatch(/\bbg-yellow-\d+\b/);
    expect(cls).not.toMatch(/\btext-gray-\d+\b/);
    expect(cls).toMatch(/\bbg-status-warning-fill\b/);
    expect(cls).toMatch(/\btext-status-warning-foreground\b/);
  });
});
