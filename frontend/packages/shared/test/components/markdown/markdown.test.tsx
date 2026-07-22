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

import { Markdown } from "@/components/markdown";

describe("Markdown", () => {
  it("renders a heading", () => {
    render(<Markdown content="# Title" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Title",
    );
  });

  it("renders bold text via <strong>", () => {
    render(<Markdown content="**bold**" />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("renders an unordered list", () => {
    render(<Markdown content={"- one\n- two"} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["one", "two"]);
  });

  it("renders a GFM table (remark-gfm enabled)", () => {
    const table = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    render(<Markdown content={table} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "a" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument();
  });

  it("escapes raw HTML instead of executing it (no rehype-raw)", () => {
    render(<Markdown content="<script>alert(1)</script>" />);
    // The raw tag must surface as visible text, never a live <script> node.
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("gives external links a safe rel", () => {
    render(<Markdown content="[docs](https://example.com)" />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("sanitizes a javascript: link href", () => {
    // Characterization: react-markdown's defaultUrlTransform strips unsafe
    // schemes, leaving an empty href — which also drops the implicit `link`
    // role, so query by text. Locks it in so a future custom urlTransform /
    // rehype-raw can't silently regress it.
    render(<Markdown content="[x](javascript:alert(1))" />);
    const link = screen.getByText("x");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href") ?? "").toBe("");
  });

  it("renders an external image with referrerPolicy=no-referrer", () => {
    // Privacy: without an explicit policy, fetching an external image leaks the
    // viewer's IP + the full asset URL to the image host via the Referer header
    // (unlike <a>, <img> isn't covered by rel="noreferrer").
    render(<Markdown content="![chart](https://example.com/a.png)" />);
    const img = screen.getByRole("img", { name: "chart" });
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
    expect(img).toHaveAttribute("referrerPolicy", "no-referrer");
  });

  it("sanitizes a javascript: image src", () => {
    render(<Markdown content="![x](javascript:alert(1))" />);
    const img = screen.getByRole("img", { name: "x" });
    expect(img.getAttribute("src") ?? "").toBe("");
  });

  it("sanitizes a data: image src", () => {
    render(
      <Markdown content="![x](data:text/html,<script>alert(1)</script>)" />,
    );
    const img = screen.getByRole("img", { name: "x" });
    expect(img.getAttribute("src") ?? "").toBe("");
  });

  it("renders inline code as a token-styled pill (not a fenced block)", () => {
    render(<Markdown content="use `npm test` now" />);
    const code = screen.getByText("npm test");
    expect(code.tagName).toBe("CODE");
    expect(code).toHaveClass("bg-surface-muted");
  });

  it("streaming renders the same DOM as the one-shot path for identical content", () => {
    const content = "# Title\n\nSome text here.";
    const oneShot = render(<Markdown content={content} />);
    const streamed = render(<Markdown content={content} streaming />);
    // Identical rendered structure. The split seam drops the inter-block
    // whitespace text node react-markdown emits in a single parse — visually
    // inert (block layout collapses it), so normalize it away before comparing.
    const normalize = (html: string): string => html.replace(/>\s+</g, "><");
    expect(normalize(streamed.container.innerHTML)).toBe(
      normalize(oneShot.container.innerHTML),
    );
  });

  it("keeps the settled prefix's element identity across a tail append", () => {
    const { container, rerender } = render(
      <Markdown content={"# Title\n\nfirst"} streaming />,
    );
    const before = container.querySelector("h1");
    rerender(<Markdown content={"# Title\n\nfirst and more"} streaming />);
    const after = container.querySelector("h1");
    // The stable prefix ("# Title\n\n") is unchanged by the append, so its
    // memoized node survives — only the live tail re-parses.
    expect(before).not.toBeNull();
    expect(after).toBe(before);
  });

  it("renders a fenced code block as a CodeBox not wrapped in <pre>", () => {
    const { container } = render(
      <Markdown content={"```js\nconst x = 1;\n```"} />,
    );
    // The `code` override returns a <details> CodeBox; the `pre` passthrough
    // unwraps react-markdown's default <pre>, so a <details> inside <pre>
    // (invalid HTML, UA-pre styling bleed) never happens.
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    expect(details?.closest("pre")).toBeNull();
  });

  it("keeps DOM identity when toggling streaming off (no remount)", () => {
    const content = "# Title\n\nbody";
    const { container, rerender } = render(
      <Markdown content={content} streaming />,
    );
    const before = container.querySelector("h1");
    // Both modes render the same two-block Fragment shape, so flipping
    // streaming true→false (a common end-of-stream transition) must not swap
    // the element type and remount the subtree.
    rerender(<Markdown content={content} />);
    const after = container.querySelector("h1");
    expect(before).not.toBeNull();
    expect(after).toBe(before);
  });
});
