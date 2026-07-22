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
import { Globe } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { FileTile } from "@/components/file-tile";

describe("<FileTile>", () => {
  it("renders the filename", () => {
    render(<FileTile filename="report.pdf" onRemove={vi.fn()} />);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("shows no spinner when ready (the default status)", () => {
    render(<FileTile filename="report.pdf" onRemove={vi.fn()} />);
    expect(screen.queryByTestId("file-tile-loading")).toBeNull();
  });

  it("shows a spinner while loading", () => {
    render(
      <FileTile filename="report.pdf" status="loading" onRemove={vi.fn()} />,
    );
    expect(screen.getByTestId("file-tile-loading")).toBeInTheDocument();
  });

  it("fires onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    render(<FileTile filename="report.pdf" onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("uses removeLabel as the remove button's accessible name", () => {
    render(
      <FileTile
        filename="report.pdf"
        removeLabel="Remove attachment"
        onRemove={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Remove attachment" }),
    ).toBeInTheDocument();
  });

  // Glyphs render at stroke-width 1.5 for a lighter, more refined line — set
  // explicitly so tabler icons (which ignore LucideProvider) match lucide.
  it("renders the url glyph at stroke-width 1.5 to match the lucide icons", () => {
    const { container } = render(
      <FileTile filename="bookmark.url" onRemove={vi.fn()} />,
    );
    expect(container.querySelector(".tabler-icon-world")).toHaveAttribute(
      "stroke-width",
      "1.5",
    );
  });

  // Filenames sometimes arrive with a leading markdown-heading `#` (e.g. a
  // spec doc titled "# Spec: …"). Strip it so the chip reads as a filename,
  // not a heading.
  it("strips a leading '#' prefix from the displayed filename", () => {
    render(<FileTile filename="# Spec: Tokens.md" onRemove={vi.fn()} />);
    expect(screen.getByText("Spec: Tokens.md")).toBeInTheDocument();
    expect(screen.queryByText(/^#/)).toBeNull();
  });

  it("renders no remove control when onRemove is omitted (read-only)", () => {
    render(<FileTile filename="report.pdf" />);
    expect(screen.queryByRole("button", { name: "Remove file" })).toBeNull();
  });

  // A deliverable's glyph is driven by its kind, not its filename, so `icon`
  // overrides the extension-derived default (`report.pdf` would map to File).
  it("renders the provided icon, overriding the filename default", () => {
    const { container } = render(
      <FileTile filename="report.pdf" icon={Globe} />,
    );
    expect(container.querySelector(".lucide-globe")).toBeInTheDocument();
    expect(container.querySelector(".lucide-file")).toBeNull();
  });

  // --- onActivate: the deliverable open affordance (D1) -----------------------

  it("exposes the tile as an activatable button when onActivate is given", () => {
    render(<FileTile filename="report.pdf" onActivate={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /report\.pdf/ }),
    ).toBeInTheDocument();
  });

  it("fires onActivate when the tile is clicked", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<FileTile filename="report.pdf" onActivate={onActivate} />);
    await user.click(screen.getByRole("button", { name: /report\.pdf/ }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("fires onActivate when Enter is pressed on the focused tile", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<FileTile filename="report.pdf" onActivate={onActivate} />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("fires onActivate when Space is pressed on the focused tile", async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(<FileTile filename="report.pdf" onActivate={onActivate} />);
    await user.tab();
    await user.keyboard("[Space]");
    expect(onActivate).toHaveBeenCalledOnce();
  });

  // The truncated filename is a button label, not selectable copy. Without
  // `select-none`, a click/drag forms a text selection and the browser scrolls
  // the `overflow:hidden` span to reveal the selection focus — exposing the
  // characters the ellipsis was meant to hide (the "click reveals more" bug).
  it("marks the filename non-selectable so a click can't scroll-reveal it", () => {
    render(<FileTile filename="report.pdf" onActivate={vi.fn()} />);
    expect(screen.getByText("report.pdf")).toHaveClass("select-none");
  });

  // Read-only is the default: no onActivate → the tile surface is not a button
  // (no behavior change for sent attachments / static deliverables).
  it("renders no activatable control when onActivate is omitted (read-only)", () => {
    render(<FileTile filename="report.pdf" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a pointer cursor on the activatable surface", () => {
    render(<FileTile filename="report.pdf" onActivate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /report\.pdf/ })).toHaveClass(
      "cursor-pointer",
    );
  });

  // When both handlers are wired, the remove button stops propagation so a
  // remove click never bubbles into onActivate (clicking delete must not also
  // open the sidepane).
  it("does not fire onActivate when the remove button is clicked", async () => {
    const onActivate = vi.fn();
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <FileTile
        filename="report.pdf"
        onActivate={onActivate}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove file" }));

    expect(onRemove).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
