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
