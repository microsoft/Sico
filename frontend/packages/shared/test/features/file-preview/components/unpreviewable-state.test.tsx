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

import { UnpreviewableState } from "@/features/file-preview/components/unpreviewable-state";

describe("UnpreviewableState", () => {
  it("renders the shared unpreviewable heading", () => {
    render(<UnpreviewableState />);
    expect(screen.getByRole("heading")).toHaveTextContent(
      "Preview not supported for this file type.",
    );
  });

  it("fills and centers so a bare render doesn't sit flush under the header", () => {
    // The wrapper owns the centering (MessageState only sizes to its content),
    // so every viewer that renders this bare — image/video/pdf/markdown/text —
    // gets an identically centered fallback instead of one pinned to the top.
    render(<UnpreviewableState />);
    expect(screen.getByTestId("unpreviewable-state")).toHaveClass(
      "flex-1",
      "items-center",
      "justify-center",
    );
  });

  it("renders an action below the copy when given", () => {
    render(
      <UnpreviewableState action={<button type="button">Download</button>} />,
    );
    expect(
      screen.getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
  });
});
