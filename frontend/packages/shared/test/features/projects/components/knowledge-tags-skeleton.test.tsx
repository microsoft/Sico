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

import { KnowledgeTagsSkeleton } from "@/features/projects/components/knowledge-tags-skeleton";

describe("<KnowledgeTagsSkeleton>", () => {
  it("renders a content-shaped loading status for the knowledge tags page", () => {
    render(<KnowledgeTagsSkeleton />);

    expect(
      screen.getByRole("status", { name: /Loading knowledge tags/i }),
    ).toBeInTheDocument();
  });

  it("mirrors the 3-column knowledge tags table with real headers and 5 rows", () => {
    render(<KnowledgeTagsSkeleton />);

    // Real header labels (not anonymous bars) so the placeholder reads as the
    // same table.
    expect(screen.getByText("KNOWLEDGE TAG")).toBeInTheDocument();
    expect(screen.getByText("DESCRIPTION")).toBeInTheDocument();
    expect(screen.getByText("ACTIONS")).toBeInTheDocument();
    expect(screen.getAllByTestId("knowledge-tags-skeleton-row")).toHaveLength(
      5,
    );
  });
});
