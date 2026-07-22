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
import { describe, expect, it, vi } from "vitest";

import { UnsupportedViewer } from "@/features/file-preview/components/viewers/unsupported-viewer";
import { downloadFile } from "@/utils/download-file";

// The download IO is owned (and exhaustively tested) by download-file.test;
// here we mock it and assert the body action wires it with url + filename.
vi.mock("@/utils/download-file", () => ({
  downloadFile: vi.fn(() => Promise.resolve()),
}));

describe("UnsupportedViewer", () => {
  it("shows the unpreviewable heading", () => {
    render(<UnsupportedViewer fileUrl="https://x/f.bin" filename="f.bin" />);
    expect(
      screen.getByText("Preview not supported for this file type."),
    ).toBeInTheDocument();
  });

  it("downloads the file from the body action (url + filename)", async () => {
    const user = userEvent.setup();
    render(
      <UnsupportedViewer
        fileUrl="https://x/report.bin"
        filename="report.bin"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Download/ }));
    expect(downloadFile).toHaveBeenCalledWith(
      "https://x/report.bin",
      "report.bin",
    );
  });
});
