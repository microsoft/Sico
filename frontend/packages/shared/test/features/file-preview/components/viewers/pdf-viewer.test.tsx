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

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LazyPdfViewer } from "@/features/file-preview/components/viewers/lazy-pdf-viewer";
import PdfViewer from "@/features/file-preview/components/viewers/pdf-viewer";
import { logger } from "@/utils/logger";

// pdfjs can't run in jsdom (no real canvas, no worker), so the whole module is
// mocked — these tests exercise the component's state machine (loading →
// loaded / error + cleanup), not pdfjs. `vi.hoisted` lets the hoisted vi.mock
// factory reference the stub without a TDZ crash.
const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument,
}));

vi.mock("@/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The component observes its scroll container via ResizeObserver to width-fit
// the pages. The global setup stubs RO as an inert no-op; this capturing variant
// hands back the registered callback so a test can fire a resize deterministically
// (the architecture's load[fileUrl] / render[pdf,width] split is invisible without
// it). Minimal entry shape — the component only reads contentRect.width. Assigned
// directly (the setup defines RO non-configurable, so vi.stubGlobal can't redefine
// it) and restored in afterEach.
type ResizeEntryLike = { contentRect: { width: number } };
const RealResizeObserver = globalThis.ResizeObserver;

function installCapturingResizeObserver(): (width: number) => void {
  let captured: ((entries: ResizeEntryLike[]) => void) | null = null;
  globalThis.ResizeObserver = class {
    constructor(callback: (entries: ResizeEntryLike[]) => void) {
      captured = callback;
    }

    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  return (width: number) => captured?.([{ contentRect: { width } }]);
}

// A loaded document with one page; render() resolves immediately (the mocked
// canvas never paints).
function makeLoadedPdf(): {
  numPages: number;
  getPage: () => Promise<unknown>;
} {
  const page = {
    getViewport: () => ({ width: 600, height: 800 }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return {
    numPages: 1,
    getPage: () => Promise.resolve(page),
  };
}

// A doc whose pages reject ONCE its task is destroyed — models the real wedge:
// after a url swap, the prior doc's worker is torn down, so re-rendering against
// the stale proxy throws. The destroy spy flips the flag the way pdfjs's teardown
// invalidates a destroyed document.
function makeDestroyablePdf(): {
  task: { promise: Promise<unknown>; destroy: ReturnType<typeof vi.fn> };
} {
  let destroyed = false;
  const page = {
    getViewport: () => ({ width: 600, height: 800 }),
    render: () => ({ promise: Promise.resolve() }),
  };
  const pdf = {
    numPages: 1,
    getPage: () =>
      destroyed
        ? Promise.reject(new Error("destroyed"))
        : Promise.resolve(page),
  };
  const destroy = vi.fn(() => {
    destroyed = true;
    return Promise.resolve();
  });
  return { task: { promise: Promise.resolve(pdf), destroy } };
}

// pdfjs's getDocument returns a loading task: `.promise` resolves to the document
// proxy, `.destroy()` tears down network + worker. destroy is a spy so cleanup
// can be asserted.
function loadingTask(promise: Promise<unknown>): {
  promise: Promise<unknown>;
  destroy: ReturnType<typeof vi.fn>;
} {
  return { promise, destroy: vi.fn(() => Promise.resolve()) };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  globalThis.ResizeObserver = RealResizeObserver;
});

describe("PdfViewer", () => {
  it("shows a spinner while the document loads", () => {
    // A never-settling promise keeps the component in the pending state.
    getDocument.mockReturnValue(loadingTask(new Promise(() => {})));

    render(<PdfViewer fileUrl="https://blob.test/doc.pdf" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("clears the spinner once every page has rendered", async () => {
    getDocument.mockReturnValue(loadingTask(Promise.resolve(makeLoadedPdf())));

    render(<PdfViewer fileUrl="https://blob.test/doc.pdf" />);

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("renders one canvas per page into the container", async () => {
    getDocument.mockReturnValue(loadingTask(Promise.resolve(makeLoadedPdf())));

    render(<PdfViewer fileUrl="https://blob.test/doc.pdf" />);

    expect(await screen.findAllByTestId("pdf-page")).toHaveLength(1);
  });

  it("shows the download-fallback state and logs when loading fails", async () => {
    getDocument.mockReturnValue(loadingTask(Promise.reject(new Error("boom"))));

    render(<PdfViewer fileUrl="https://blob.test/doc.pdf" />);

    expect(await screen.findByRole("heading")).toHaveTextContent(
      "Preview not supported for this file type.",
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it("keeps the scroll container mounted on error (overlay, not early-return)", async () => {
    // The fallback overlays the scroll container rather than replacing it, so
    // usePageWidth's ResizeObserver (bound to that node) survives an error and
    // an error→valid in-place swap doesn't leave a stale, disconnected observer.
    getDocument.mockReturnValue(loadingTask(Promise.reject(new Error("boom"))));

    render(<PdfViewer fileUrl="https://blob.test/doc.pdf" />);

    // The fallback is shown AND the pages container is still in the tree (an
    // early `return <UnpreviewableState/>` would have unmounted it).
    await screen.findByRole("heading");
    expect(screen.getByTestId("pdf-pages")).toBeInTheDocument();
  });

  it("destroys the loading task on unmount to free the worker", async () => {
    const task = loadingTask(Promise.resolve(makeLoadedPdf()));
    getDocument.mockReturnValue(task);

    const { unmount } = render(
      <PdfViewer fileUrl="https://blob.test/doc.pdf" />,
    );
    // Wait for the load to settle so the proxy is owned before teardown.
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );

    unmount();

    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not wedge on error when a resize repaints a stale doc after a url swap (C1)", async () => {
    // The wedge: docA loads, the url swaps (destroying docA's worker), then a
    // resize re-runs the render effect. Without setPdf(null) in the reset block,
    // `pdf` still holds the destroyed docA → renderPdf's getPage rejects →
    // setError pins the download-fallback state permanently. setPdf(null) makes
    // the render effect's `!pdf` guard short-circuit instead.
    const fireResize = installCapturingResizeObserver();
    const { task } = makeDestroyablePdf();
    getDocument.mockReturnValueOnce(task);

    const { rerender } = render(
      <PdfViewer fileUrl="https://blob.test/a.pdf" />,
    );
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );

    // Swap to a url whose load never settles; this destroys docA's task.
    getDocument.mockReturnValueOnce(loadingTask(new Promise(() => {})));
    rerender(<PdfViewer fileUrl="https://blob.test/b.pdf" />);

    // A resize re-runs the render effect; act() flushes the (would-be) stale
    // render + its rejection so the error path settles inside the assertion.
    await act(async () => {
      fireResize(500);
    });

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("re-renders on a width change without re-fetching the document (C2)", async () => {
    // The architecture's central claim: load is keyed [fileUrl], render is keyed
    // [pdf, pageWidth]. A pane resize must repaint from the SAME loaded doc, never
    // call getDocument again.
    const fireResize = installCapturingResizeObserver();
    getDocument.mockReturnValue(loadingTask(Promise.resolve(makeLoadedPdf())));

    render(<PdfViewer fileUrl="https://blob.test/doc.pdf" />);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(getDocument).toHaveBeenCalledTimes(1);

    // A width inside [MIN,MAX] that differs from the default forces a new
    // pageWidth → the render effect re-runs, the load effect does not.
    act(() => fireResize(500));
    await waitFor(() =>
      expect(screen.getAllByTestId("pdf-page")).toHaveLength(1),
    );
    expect(getDocument).toHaveBeenCalledTimes(1);
  });
});

describe("LazyPdfViewer", () => {
  it("shows a Suspense spinner, then the resolved viewer", async () => {
    getDocument.mockReturnValue(loadingTask(Promise.resolve(makeLoadedPdf())));

    render(<LazyPdfViewer fileUrl="https://blob.test/doc.pdf" />);

    // The lazy chunk resolves and the pages container mounts.
    expect(await screen.findByTestId("pdf-pages")).toBeInTheDocument();
  });
});
