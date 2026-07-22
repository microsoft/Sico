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
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { AssetsToolbar } from "@/features/projects/components/assets-toolbar";
import type { AssetSearch } from "@/features/projects/schemas/asset-search";
import type { AssetCategory } from "@/features/projects/types";

// The category tabs render `<Link>`s; stub Link to a plain anchor exposing its
// resolved `to` (with `$projectId` filled) as href and forwarding the role/
// styling props Base UI's TabsTrigger injects so we can assert tab targets
// without a RouterProvider. Named props (no spread) mirror sidebar.test.tsx.
vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
      role,
      className,
      id,
    }: {
      to: string;
      params?: { projectId: string };
      children?: React.ReactNode;
      role?: string;
      className?: string;
      id?: string;
    }): React.JSX.Element => (
      <a
        href={params ? to.replace("$projectId", params.projectId) : to}
        role={role}
        className={className}
        id={id}
      >
        {children}
      </a>
    ),
  };
});

function renderToolbar(
  options: { category?: AssetCategory } & Partial<AssetSearch> = {},
): {
  onSearchChange: ReturnType<typeof vi.fn>;
  onAddKnowledge: ReturnType<typeof vi.fn>;
  user: ReturnType<typeof userEvent.setup>;
} {
  const { category = "all", ...searchOverrides } = options;
  const onSearchChange = vi.fn();
  const onAddKnowledge = vi.fn();
  const search: AssetSearch = { sort: "desc", q: "", ...searchOverrides };
  render(
    <AssetsToolbar
      projectId={1}
      category={category}
      search={search}
      onSearchChange={onSearchChange}
      onAddKnowledge={onAddKnowledge}
    />,
  );
  return { onSearchChange, onAddKnowledge, user: userEvent.setup() };
}

describe("<AssetsToolbar>", () => {
  it("collapses search to an icon button and expands it on click", async () => {
    const { user } = renderToolbar();
    // Collapsed: a 🔍 button, no input yet.
    const toggle = screen.getByRole("button", { name: "Search assets" });
    expect(
      screen.queryByRole("textbox", { name: "Search assets" }),
    ).not.toBeInTheDocument();

    await user.click(toggle);

    expect(
      screen.getByRole("textbox", { name: "Search assets" }),
    ).toBeInTheDocument();
  });

  it("starts expanded when the URL already carries a query", () => {
    renderToolbar({ q: "invoices" });
    expect(screen.getByRole("textbox", { name: "Search assets" })).toHaveValue(
      "invoices",
    );
  });

  it("shows Add Knowledge on the All and Knowledge categories", () => {
    renderToolbar({ category: "all" });
    expect(
      screen.getByRole("button", { name: "Add Knowledge" }),
    ).toBeInTheDocument();
  });

  it("hides Add Knowledge on the Deliverable and Experience categories", () => {
    renderToolbar({ category: "experience" });
    expect(
      screen.queryByRole("button", { name: "Add Knowledge" }),
    ).not.toBeInTheDocument();
  });

  it("fires onAddKnowledge when Add Knowledge is clicked", async () => {
    const { user, onAddKnowledge } = renderToolbar({ category: "knowledge" });
    await user.click(screen.getByRole("button", { name: "Add Knowledge" }));
    expect(onAddKnowledge).toHaveBeenCalledTimes(1);
  });

  it("renders each category tab as a link to its path", () => {
    renderToolbar();
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "href",
      "/project/1",
    );
    expect(screen.getByRole("tab", { name: "Knowledge" })).toHaveAttribute(
      "href",
      "/project/1/knowledge",
    );
    expect(screen.getByRole("tab", { name: "Deliverable" })).toHaveAttribute(
      "href",
      "/project/1/deliverable",
    );
    expect(screen.getByRole("tab", { name: "Experience" })).toHaveAttribute(
      "href",
      "/project/1/experience",
    );
  });
});
