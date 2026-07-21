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
