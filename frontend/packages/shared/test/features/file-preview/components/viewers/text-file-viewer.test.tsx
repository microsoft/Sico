import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { TextFileViewer } from "@/features/file-preview/components/viewers/text-file-viewer";
import { logger } from "@/utils/logger";

vi.mock("@/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const FILE_URL = "https://blob.test/files/notes.txt";
const ERROR_HEADING = "Preview not supported for this file type.";

function textResponse(body: string): Response {
  return { ok: true, text: () => Promise.resolve(body) } as Response;
}

function errorStatusResponse(status: number, body: string): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as Response;
}

describe("TextFileViewer", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a spinner while the file is still fetching", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<TextFileViewer fileUrl={FILE_URL} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("fetches the file url through an abort signal", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<TextFileViewer fileUrl={FILE_URL} />);
    expect(fetchMock).toHaveBeenCalledWith(FILE_URL, {
      signal: expect.any(AbortSignal),
    });
  });

  it("renders the fetched text verbatim (not parsed as markdown)", async () => {
    // A leading '#' is a markdown heading — a text viewer must show it LITERALLY,
    // proving the body is raw <pre> text, not run through the Markdown renderer.
    fetchMock.mockResolvedValue(textResponse("# Hello\nplain line"));
    render(<TextFileViewer fileUrl={FILE_URL} />);
    expect(await screen.findByText(/# Hello/)).toBeInTheDocument();
    // No heading element — confirms it was NOT markdown-parsed.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("clears the spinner once the text has rendered", async () => {
    fetchMock.mockResolvedValue(textResponse("hello"));
    render(<TextFileViewer fileUrl={FILE_URL} />);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("gives the body a fluid reading gutter (px-4, widening to px-34 at @3xl)", async () => {
    // #260: a fixed px-34 crushes the body in a narrow side-pane. The gutter is
    // now container-query driven — px-4 by default, px-34 only once the pane is
    // wide (@3xl). jsdom can't evaluate the container query, so this pins the
    // class contract rather than the resolved padding.
    fetchMock.mockResolvedValue(textResponse("hello"));
    render(<TextFileViewer fileUrl={FILE_URL} />);
    await screen.findByText("hello");
    expect(screen.getByTestId("file-text")).toHaveClass("px-4", "@3xl:px-34");
  });

  it("shows the download-fallback state when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    render(<TextFileViewer fileUrl={FILE_URL} />);
    expect(await screen.findByRole("heading")).toHaveTextContent(ERROR_HEADING);
  });

  it("logs the failure rather than swallowing it", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    render(<TextFileViewer fileUrl={FILE_URL} />);
    await waitFor(() => expect(logger.error).toHaveBeenCalled());
  });

  it("shows the download-fallback for an HTTP error status, not the error body", async () => {
    fetchMock.mockResolvedValue(
      errorStatusResponse(403, "AuthenticationFailed"),
    );
    render(<TextFileViewer fileUrl={FILE_URL} />);
    expect(await screen.findByRole("heading")).toHaveTextContent(ERROR_HEADING);
    expect(screen.queryByText(/AuthenticationFailed/)).not.toBeInTheDocument();
  });

  it("re-shows the spinner when the url changes after a load (MP13)", async () => {
    fetchMock.mockResolvedValue(textResponse("hello"));
    const { rerender } = render(<TextFileViewer fileUrl={FILE_URL} />);
    await screen.findByText("hello");

    fetchMock.mockReturnValue(new Promise(() => {}));
    rerender(<TextFileViewer fileUrl="https://blob.test/files/other.txt" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("aborts the in-flight fetch on unmount (no state update after teardown)", () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) => {
        capturedSignal = init.signal;
        return new Promise(() => {});
      },
    );
    const { unmount } = render(<TextFileViewer fileUrl={FILE_URL} />);
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
