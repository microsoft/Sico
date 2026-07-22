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

import { VideoViewer } from "@/features/file-preview/components/viewers/video-viewer";

const FILE_URL = "https://blob.test/p/clip.mp4";
const UNPREVIEWABLE_HEADING = "Preview not supported for this file type.";

describe("VideoViewer", () => {
  it("shows a spinner until the video can play", () => {
    render(<VideoViewer fileUrl={FILE_URL} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByTestId("file-video")).toHaveAttribute("src", FILE_URL);
  });

  it("clears the spinner once the video can play", () => {
    render(<VideoViewer fileUrl={FILE_URL} />);
    fireEvent.canPlay(screen.getByTestId("file-video"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the download-fallback when the video fails to load", () => {
    // A load failure (expired SAS / 404 / unsupported codec) fires the element's
    // `error` event; `onCanPlay` never comes, so without this the spinner would
    // spin forever.
    render(<VideoViewer fileUrl={FILE_URL} />);
    fireEvent.error(screen.getByTestId("file-video"));
    expect(screen.getByRole("heading")).toHaveTextContent(
      UNPREVIEWABLE_HEADING,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("re-shows the spinner when the url changes after a load (MP13)", () => {
    const { rerender } = render(<VideoViewer fileUrl={FILE_URL} />);
    fireEvent.canPlay(screen.getByTestId("file-video"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // The same instance gets a new url — the spinner must reappear rather than
    // showing the prior frame.
    rerender(<VideoViewer fileUrl="https://blob.test/p/other.mp4" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("clears a prior error when the url changes (MP13)", () => {
    const { rerender } = render(<VideoViewer fileUrl={FILE_URL} />);
    fireEvent.error(screen.getByTestId("file-video"));
    expect(screen.getByRole("heading")).toBeInTheDocument();

    // A new url must not pin the new (valid) video on the error fallback.
    rerender(<VideoViewer fileUrl="https://blob.test/p/other.mp4" />);
    expect(screen.getByTestId("file-video")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
