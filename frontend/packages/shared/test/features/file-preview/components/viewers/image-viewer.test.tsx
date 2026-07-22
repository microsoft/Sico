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
import { describe, expect, it } from "vitest";

import { ImageViewer } from "@/features/file-preview/components/viewers/image-viewer";

const FILE_URL = "https://blob.test/p/cat.png";
const UNPREVIEWABLE_HEADING = "Preview not supported for this file type.";

describe("ImageViewer", () => {
  it("uses the filename as the image's accessible name", () => {
    render(<ImageViewer fileUrl={FILE_URL} alt="cat.png" />);
    expect(screen.getByRole("img", { name: "cat.png" })).toHaveAttribute(
      "src",
      FILE_URL,
    );
  });

  it("constrains a wide image on both axes so it can't overflow x (C5)", () => {
    // max-h-full alone lets a wide image bleed past the pane horizontally;
    // max-w-full clamps the other axis too.
    render(<ImageViewer fileUrl={FILE_URL} alt="cat.png" />);
    expect(screen.getByRole("img", { name: "cat.png" })).toHaveClass(
      "max-h-full",
      "max-w-full",
    );
  });

  it("shows the download-fallback when the image fails to load", () => {
    // A broken source (expired SAS / 404) fires the img `error` event; without
    // a fallback the browser shows its default broken glyph.
    render(<ImageViewer fileUrl={FILE_URL} alt="cat.png" />);
    fireEvent.error(screen.getByRole("img", { name: "cat.png" }));
    expect(screen.getByRole("heading")).toHaveTextContent(
      UNPREVIEWABLE_HEADING,
    );
  });

  it("clears a prior error when the url changes (MP13)", () => {
    const { rerender } = render(
      <ImageViewer fileUrl={FILE_URL} alt="cat.png" />,
    );
    fireEvent.error(screen.getByRole("img", { name: "cat.png" }));
    expect(screen.getByRole("heading")).toBeInTheDocument();

    // The same instance gets a new url — the prior error must not pin the new
    // (valid) image on the fallback.
    rerender(
      <ImageViewer fileUrl="https://blob.test/p/dog.png" alt="dog.png" />,
    );
    expect(screen.getByRole("img", { name: "dog.png" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
