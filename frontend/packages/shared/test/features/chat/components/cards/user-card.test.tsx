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

import { UserCard } from "@/features/chat/components/cards/user-card";

describe("UserCard", () => {
  it("renders the user's text", () => {
    render(<UserCard text="run the full performance suite" />);
    expect(
      screen.getByText("run the full performance suite"),
    ).toBeInTheDocument();
  });

  it("styles the bubble with the lavender user-input surface + primary text", () => {
    render(<UserCard text="hi" />);
    expect(screen.getByText("hi")).toHaveClass(
      "bg-surface-user-input",
      "text-foreground-primary",
    );
  });

  it("right-aligns a content-hugging bubble (ml-auto + w-fit)", () => {
    render(<UserCard text="hi" />);
    expect(screen.getByText("hi")).toHaveClass("ml-auto", "w-fit");
  });

  it("preserves the multi-line input's line breaks", () => {
    render(<UserCard text={"line one\nline two"} />);
    // whitespace-pre-wrap keeps the typed newline (the legacy plain div collapsed it).
    expect(screen.getByText(/line one/)).toHaveClass("whitespace-pre-wrap");
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(<UserCard text="hi" />);
    const bubble = container.firstElementChild;
    expect(bubble?.className).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(bubble?.getAttribute("style") ?? "").not.toMatch(
      /#[0-9a-fA-F]{3,8}/,
    );
  });
});
