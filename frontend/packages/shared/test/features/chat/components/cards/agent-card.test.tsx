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

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentCard } from "@/features/chat/components/cards/agent-card";

describe("AgentCard", () => {
  it("renders the agent's text as Markdown (bold -> <strong>)", () => {
    render(<AgentCard text="**done**" />);
    expect(screen.getByText("done").tagName).toBe("STRONG");
  });

  it("renders GFM tables (flows through remark-gfm)", () => {
    const table = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    render(<AgentCard text={table} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("escapes raw HTML — routes through the XSS-safe Markdown (no rehype-raw)", () => {
    render(<AgentCard text="<script>alert(1)</script>" />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("is an unframed left-aligned body (no bubble surface, no right-align)", () => {
    const { container } = render(<AgentCard text="hi" />);
    const root = container.firstElementChild;
    // Unlike UserCard, the agent reply has no lavender bubble and never hugs
    // the right edge — it flows full-width, left-aligned.
    expect(root?.className).not.toMatch(
      /bg-surface-user-input|ml-auto|rounded/,
    );
  });

  it("forwards streaming so the settled prefix keeps identity across a tail append", () => {
    // The streaming reveal is animated (useSmoothText), so drive fake timers to
    // let the prefix fully appear before sampling its DOM node.
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <AgentCard text={"# Title\n\nfirst"} streaming />,
      );
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      const before = container.querySelector("h1");
      rerender(<AgentCard text={"# Title\n\nfirst and more"} streaming />);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      const after = container.querySelector("h1");
      // Only possible if `streaming` reached <Markdown>: the frozen prefix block
      // keeps its DOM node while just the live tail re-parses.
      expect(before).not.toBeNull();
      expect(after).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(<AgentCard text="hi" />);
    const root = container.firstElementChild;
    expect(root?.className).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(root?.getAttribute("style") ?? "").not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
