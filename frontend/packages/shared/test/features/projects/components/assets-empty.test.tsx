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

import { AssetsEmpty } from "@/features/projects/components/assets-empty";

describe("<AssetsEmpty>", () => {
  it("renders the interpolated search no-match body for the search variant", () => {
    render(<AssetsEmpty variant="search" query="invoices" />);

    expect(screen.getByRole("heading", { name: "No assets yet" }));
    expect(
      screen.getByText('No assets match "invoices". Try a different search.'),
    ).toBeInTheDocument();
  });

  it("renders the All category body and heading", () => {
    render(<AssetsEmpty variant="category" category="all" />);

    expect(
      screen.getByRole("heading", { name: "No assets yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Upload knowledge or wait for your digital workers to produce deliverables.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the Knowledge category body", () => {
    render(<AssetsEmpty variant="category" category="knowledge" />);

    expect(
      screen.getByText("Add knowledge to give this project shared context."),
    ).toBeInTheDocument();
  });

  it("renders the Deliverable category body", () => {
    render(<AssetsEmpty variant="category" category="deliverable" />);

    expect(
      screen.getByText(
        "Deliverables will appear here once your digital workers publish them.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the Experience category body", () => {
    render(<AssetsEmpty variant="category" category="experience" />);

    expect(
      screen.getByText(
        "Experiences will appear here as your digital workers learn from tasks.",
      ),
    ).toBeInTheDocument();
  });
});
