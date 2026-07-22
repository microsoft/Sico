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

import { AssetsTableSkeleton } from "@/features/projects/components/assets-table-skeleton";

describe("<AssetsTableSkeleton>", () => {
  it("renders a content-shaped loading status for the assets table", () => {
    render(<AssetsTableSkeleton />);

    expect(
      screen.getByRole("status", { name: /loading assets/i }),
    ).toBeInTheDocument();
  });

  it("mirrors the assets table with 5 placeholder body rows", () => {
    render(<AssetsTableSkeleton />);

    expect(screen.getAllByTestId("assets-table-skeleton-row")).toHaveLength(5);
  });

  it("never renders a spinner — uses a content-shaped skeleton instead (§6 dec 8)", () => {
    render(<AssetsTableSkeleton />);

    // The @sico/ui Spinner renders role="status" + aria-label="Loading" (exact).
    // The skeleton root's name is "Loading assets", so this exact matcher only
    // trips if a real spinner is rendered.
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
  });

  it("as a nested block it drops its own status so the parent owns the live region", () => {
    render(<AssetsTableSkeleton asNestedBlock />);

    // Composed inside ProjectWorkspaceSkeleton (which owns the single status),
    // it must not add a second live region — mirrors ProjectCardSkeleton.
    expect(screen.queryByRole("status")).toBeNull();
    // …but it still renders the table shape (the placeholder rows survive).
    expect(screen.getAllByTestId("assets-table-skeleton-row")).toHaveLength(5);
  });

  it("as a nested block it keeps the flex height-chain so the card fills its parent", () => {
    render(<AssetsTableSkeleton asNestedBlock />);

    // The page-level ProjectWorkspaceSkeleton nests this inside a flex-col
    // column. Without `flex min-h-0 flex-1` on the root, the inner card's
    // `flex-1` has no stretching flex ancestor, so the table collapses to its 5
    // placeholder rows instead of filling the viewport — diverging from the real
    // AssetsTable (whose flex-1 root IS a direct flex child). The height chain
    // must hold in nested mode exactly as it does standalone.
    expect(screen.getByTestId("assets-table-skeleton")).toHaveClass(
      "flex",
      "min-h-0",
      "flex-1",
    );
  });

  it("the bare variant keeps the rows + status but drops the card shell", () => {
    // `AssetsTable`'s cold load renders <AssetsTableSkeleton variant="bare" />
    // INSIDE its persistent scroll card (the card + infinite-scroll sentinel stay
    // mounted across query states — the C1/C2 fix). `bare` must therefore drop
    // the skeleton's own `bg-surface-basic … rounded-2xl` card shell (the parent
    // provides it) while keeping the placeholder rows and the "Loading assets"
    // status intact.
    render(<AssetsTableSkeleton variant="bare" />);

    // Functionally intact: rows still render, status still announced.
    expect(
      screen.getByRole("status", { name: /loading assets/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("assets-table-skeleton-row")).toHaveLength(5);

    // No own card shell: a parent scroll card owns the surface/rounding now, so
    // the skeleton must not double it up.
    expect(screen.queryByTestId("assets-table-skeleton-card")).toBeNull();
  });

  it("renders its own card shell when NOT bare (the full variant)", () => {
    render(<AssetsTableSkeleton variant="full" />);

    expect(
      screen.getByTestId("assets-table-skeleton-card"),
    ).toBeInTheDocument();
  });

  it("mirrors the text column headers", () => {
    render(<AssetsTableSkeleton />);

    // The skeleton <Table> is aria-hidden, so its <th>s carry no columnheader
    // role — query the header labels as text instead.
    expect(screen.getByText("ASSET NAME")).toBeInTheDocument();
    expect(screen.getByText("CREATED TIME")).toBeInTheDocument();
  });

  it("leaves the ACTIONS header empty (no word, no ··· glyph)", () => {
    const { container } = render(<AssetsTableSkeleton />);

    // The ACTIONS header carries neither the literal label nor the decorative
    // ··· glyph — the column stays (pinned, sized for the row menu) but its
    // header is blank.
    expect(screen.queryByText("ACTIONS")).toBeNull();
    expect(container.querySelector(".lucide-ellipsis")).toBeNull();
  });
});
