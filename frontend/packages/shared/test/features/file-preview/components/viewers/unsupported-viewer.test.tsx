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
