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

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ImageTile } from "@/components/image-tile";

const SRC = "blob:preview";

describe("<ImageTile>", () => {
  it("renders the image with its src and alt", () => {
    render(<ImageTile src={SRC} alt="pic.png" onRemove={vi.fn()} />);
    const img = screen.getByRole("img", { name: "pic.png" });
    expect(img).toHaveAttribute("src", SRC);
  });

  it("shows no spinner when ready (the default status)", () => {
    render(<ImageTile src={SRC} alt="pic.png" onRemove={vi.fn()} />);
    expect(screen.queryByTestId("image-tile-loading")).toBeNull();
  });

  it("overlays a spinner while loading, keeping the image mounted", () => {
    render(
      <ImageTile src={SRC} alt="pic.png" status="loading" onRemove={vi.fn()} />,
    );
    expect(screen.getByTestId("image-tile-loading")).toBeInTheDocument();
    // The overlay sits over the rendered <img>, not in place of it.
    expect(screen.getByRole("img")).toHaveAttribute("src", SRC);
  });

  it("shows the broken fallback for an empty src (no <img> to render)", () => {
    render(<ImageTile src="  " alt="pic.png" />);
    // The fallback is a role="img" div with no src attribute (vs the real <img>).
    expect(screen.getByRole("img", { name: "pic.png" })).not.toHaveAttribute(
      "src",
    );
  });

  it("falls back to the broken glyph when the image fails to load", () => {
    render(<ImageTile src={SRC} alt="pic.png" />);
    fireEvent.error(screen.getByRole("img", { name: "pic.png" }));
    expect(screen.getByRole("img", { name: "pic.png" })).not.toHaveAttribute(
      "src",
    );
  });

  it("recovers when a fresh src arrives after a load error", () => {
    // A late-arriving / refreshed sasUrl must clear the broken latch — a one-way
    // boolean would stay stuck on the fallback and re-introduce the permanent
    // broken thumbnail the AttachmentChip re-mint fix was written to prevent.
    const { rerender } = render(<ImageTile src={SRC} alt="pic.png" />);
    fireEvent.error(screen.getByRole("img", { name: "pic.png" }));
    expect(screen.getByRole("img", { name: "pic.png" })).not.toHaveAttribute(
      "src",
    );

    rerender(<ImageTile src="blob:fresh" alt="pic.png" />);
    expect(screen.getByRole("img", { name: "pic.png" })).toHaveAttribute(
      "src",
      "blob:fresh",
    );
  });

  it("fires onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    render(<ImageTile src={SRC} alt="pic.png" onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove image" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("does not also activate the tile when remove is clicked (both wired)", async () => {
    // The remove button stops propagation, so a click removes without bubbling
    // into the tile's onActivate — no double action.
    const onRemove = vi.fn();
    const onActivate = vi.fn();
    render(
      <ImageTile
        src={SRC}
        alt="pic.png"
        onRemove={onRemove}
        onActivate={onActivate}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove image" }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("uses removeLabel as the remove button's accessible name", () => {
    render(
      <ImageTile
        src={SRC}
        alt="pic.png"
        removeLabel="Remove attachment"
        onRemove={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Remove attachment" }),
    ).toBeInTheDocument();
  });

  it("renders no remove control when onRemove is omitted (read-only)", () => {
    render(<ImageTile src={SRC} alt="pic.png" />);
    expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();
  });

  it("fires onActivate when the tile surface is clicked", async () => {
    const onActivate = vi.fn();
    render(<ImageTile src={SRC} alt="pic.png" onActivate={onActivate} />);
    await userEvent.click(screen.getByRole("button", { name: "pic.png" }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("activates on Enter when the tile has keyboard focus", async () => {
    const onActivate = vi.fn();
    render(<ImageTile src={SRC} alt="pic.png" onActivate={onActivate} />);
    screen.getByRole("button", { name: "pic.png" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("activates on Space when the tile has keyboard focus", async () => {
    const onActivate = vi.fn();
    render(<ImageTile src={SRC} alt="pic.png" onActivate={onActivate} />);
    screen.getByRole("button", { name: "pic.png" }).focus();
    await userEvent.keyboard(" ");
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("exposes no button role when onActivate is omitted (read-only)", () => {
    render(<ImageTile src={SRC} alt="pic.png" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a pointer cursor on the activatable surface", () => {
    render(<ImageTile src={SRC} alt="pic.png" onActivate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "pic.png" })).toHaveClass(
      "cursor-pointer",
    );
  });
});
