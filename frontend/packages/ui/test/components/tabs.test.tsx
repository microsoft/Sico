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

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import * as pkg from "../../src";

/* ─── Helper ─────────────────────────────────────────────────── */

function renderTabs(
  variant?: "default" | "line" | "pill",
  size?: "sm" | "md",
): ReturnType<typeof render> {
  return render(
    <Tabs defaultValue="a">
      <TabsList variant={variant} size={size}>
        <TabsTrigger value="a">Tab A</TabsTrigger>
        <TabsTrigger value="b">Tab B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
    </Tabs>,
  );
}

/* ─── Tests ──────────────────────────────────────────────────── */

describe("Tabs", () => {
  it("renders a tablist with its tabs", (): void => {
    renderTabs();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  describe("variants", () => {
    it("variant=default → bg-muted", (): void => {
      renderTabs("default");
      expect(screen.getByRole("tablist")).toHaveClass("bg-muted");
    });

    it("variant=line → gap-4 bg-transparent", (): void => {
      renderTabs("line");
      const list = screen.getByRole("tablist");
      expect(list).toHaveClass("bg-transparent");
      expect(list).toHaveClass("gap-4");
    });

    it("variant=pill → gap-2 bg-transparent", (): void => {
      renderTabs("pill");
      const list = screen.getByRole("tablist");
      expect(list).toHaveClass("bg-transparent");
      expect(list).toHaveClass("gap-2");
    });

    it("defaults to the default variant (bg-muted) when no variant prop", (): void => {
      renderTabs();
      expect(screen.getByRole("tablist")).toHaveClass("bg-muted");
    });
  });

  describe("sizes", () => {
    // The size prop's only DOM output is the data-size attr; the height itself
    // lives in static base-string selectors (group-data-…:data-[size=sm]:h-8)
    // that are present regardless of the prop, so assert the attr, not the class.
    it("size=sm → data-size attribute", (): void => {
      renderTabs("default", "sm");
      expect(screen.getByRole("tablist")).toHaveAttribute("data-size", "sm");
    });

    it("size=md → data-size attribute", (): void => {
      renderTabs("default", "md");
      expect(screen.getByRole("tablist")).toHaveAttribute("data-size", "md");
    });

    it("defaults to sm via data-size attribute", (): void => {
      renderTabs();
      expect(screen.getByRole("tablist")).toHaveAttribute("data-size", "sm");
    });
  });

  describe("state classes", () => {
    it("disabled trigger → is disabled to the user", (): void => {
      render(
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">Tab A</TabsTrigger>
            <TabsTrigger value="b" disabled>
              Tab B
            </TabsTrigger>
          </TabsList>
          <TabsContent value="a">Panel A</TabsContent>
        </Tabs>,
      );
      // Base UI marks a disabled Tab with aria-disabled (it stays a focusable
      // button), not the native `disabled` attribute — so toBeDisabled() (which
      // only sees native disabled) wouldn't catch it. Assert the a11y state.
      expect(screen.getByRole("tab", { name: /tab b/i })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByRole("tab", { name: /tab a/i })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
  });

  describe("public package exports", () => {
    it("re-exports Tabs and its parts from @sico/ui", (): void => {
      expect(pkg.Tabs).toBe(Tabs);
      expect(pkg.TabsList).toBe(TabsList);
      expect(pkg.TabsTrigger).toBe(TabsTrigger);
      expect(pkg.TabsContent).toBe(TabsContent);
    });
  });
});
