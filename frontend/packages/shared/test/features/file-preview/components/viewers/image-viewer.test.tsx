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
