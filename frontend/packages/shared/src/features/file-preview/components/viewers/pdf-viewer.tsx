import type { PDFDocumentProxy } from "pdfjs-dist";
import { type JSX, type RefObject, useEffect, useRef, useState } from "react";

import { logger } from "../../../../utils/logger";
import {
  clampWidth,
  loadPdf,
  MAX_PAGE_WIDTH,
  renderPdf,
} from "../../utils/render-pdf";
import { LoadingOverlay } from "../loading-overlay";
import { UnpreviewableState } from "../unpreviewable-state";

export type PdfViewerProps = {
  fileUrl: string;
};

// The measured width the pages are fit to, owned by a ResizeObserver on the
// scroll container. Extracted from the component so a resize repaints (render
// effect keyed on this) without bloating PdfViewer past the function-length cap;
// the observer is disconnected on unmount so it never leaks.
function usePageWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [pageWidth, setPageWidth] = useState(MAX_PAGE_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width) {
        return;
      }
      setPageWidth((prev) => {
        const next = clampWidth(width);
        return next === prev ? prev : next;
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return pageWidth;
}

/**
 * PDF body — rasterizes each page to its own canvas via pdfjs and stacks them
 * vertically, width-fit to the pane. Reached only through `LazyPdfViewer`'s
 * dynamic import, so pdfjs stays out of the main bundle.
 *
 * Two effects split the work: load (keyed on `fileUrl`) owns the loading task
 * and its `destroy`; render (keyed on `pdf` + measured width) repaints on a pane
 * resize without re-fetching. Replace-in-place (MP13): `loading`/`error` reset in
 * render the moment the url changes, so a swap can't flash the prior document's
 * pages or error.
 */
export default function PdfViewer({ fileUrl }: PdfViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const pageWidth = usePageWidth(scrollRef);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [prevUrl, setPrevUrl] = useState(fileUrl);
  if (fileUrl !== prevUrl) {
    setPrevUrl(fileUrl);
    setLoading(true);
    setError(false);
    // Drop the prior doc too: else a resize mid-swap re-runs the render effect
    // against the about-to-be-destroyed proxy → getPage rejects → wedged on error.
    setPdf(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    const task = loadPdf(fileUrl);
    task.promise
      .then((doc) => {
        if (!controller.signal.aborted) {
          setPdf(doc);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        logger.error("pdf load failed", { error: cause });
        setError(true);
        setLoading(false);
      });
    return () => {
      controller.abort();
      // Aborts the network if still loading and tears down the worker if the
      // doc already resolved — one call covers both.
      void task.destroy();
    };
  }, [fileUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!pdf || !container) {
      return undefined;
    }
    const controller = new AbortController();
    renderPdf(pdf, container, controller.signal, pageWidth)
      .then(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        // An aborted pass (url swap / resize / unmount) rejects by design — only
        // a real render failure surfaces as the download-fallback state.
        if (controller.signal.aborted) {
          return;
        }
        logger.error("pdf render failed", { error: cause });
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [pdf, pageWidth]);

  // Keep the scroll container mounted on error (overlay the fallback) rather
  // than early-returning: `usePageWidth`'s ResizeObserver is bound to this same
  // node, so unmounting it on an A-fails→B-opens in-place swap would leave the
  // observer disconnected and `pageWidth` frozen for document B. The opaque
  // overlay hides the (empty) pages stack behind it.
  return (
    <div
      ref={scrollRef}
      className="relative flex flex-1 justify-center overflow-auto p-4"
    >
      {loading && <LoadingOverlay />}
      <div ref={containerRef} data-testid="pdf-pages" />
      {error && (
        <div className="bg-surface-basic absolute inset-0 flex">
          <UnpreviewableState />
        </div>
      )}
    </div>
  );
}
