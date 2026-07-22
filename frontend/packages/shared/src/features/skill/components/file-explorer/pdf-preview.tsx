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

import { Spinner } from "@sico/ui";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const DEFAULT_PAGE_WIDTH = 794;

// Reading `signal.aborted` directly lets TS narrow it to a constant across
// awaits; going through a function keeps each check a real runtime read.
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function renderPdf(
  pdf: PDFDocumentProxy,
  container: HTMLDivElement,
  pageWidth: number,
  signal: AbortSignal,
): Promise<void> {
  container.replaceChildren();
  const dpr = window.devicePixelRatio || 1;
  for (let i = 1; i <= pdf.numPages; i += 1) {
    if (isAborted(signal)) {
      return;
    }
    const page = await pdf.getPage(i);
    if (isAborted(signal)) {
      return;
    }
    const scale = pageWidth / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.style.marginBottom = "16px";
    canvas.style.boxShadow =
      "0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08)";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      continue;
    }
    ctx.scale(dpr, dpr);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  }
}

// Renders a PDF to canvas pages via pdf.js (matches the legacy PDFViewer), not
// an embedded <object>, so previews look identical across browsers.
export function PdfPreview({ fileUrl }: { fileUrl: string }): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [pageWidth, setPageWidth] = useState(DEFAULT_PAGE_WIDTH);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? DEFAULT_PAGE_WIDTH;
      setPageWidth(Math.max(Math.min(width - 48, DEFAULT_PAGE_WIDTH), 300));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      setLoading(true);
      void taskRef.current?.destroy();
      taskRef.current = null;
      try {
        const task = pdfjsLib.getDocument({ url: fileUrl });
        taskRef.current = task;
        const pdf: PDFDocumentProxy = await task.promise;
        if (isAborted(signal)) {
          void task.destroy();
          return;
        }
        await renderPdf(pdf, container, pageWidth, signal);
        if (!isAborted(signal)) {
          // Clear any error from a previous fileUrl now that this load rendered.
          setError(false);
        }
      } catch {
        // Aborts are expected on unmount / url change — only a genuine parse or
        // render failure should surface. Show a fallback instead of leaving a
        // permanently blank panel with an unhandled rejection.
        if (!isAborted(signal)) {
          setError(true);
        }
      } finally {
        if (!isAborted(signal)) {
          setLoading(false);
        }
      }
    },
    [fileUrl, pageWidth],
  );

  useEffect(() => {
    const controller = new AbortController();
    // load() drives the PDF fetch/render lifecycle and sets loading/error as it
    // progresses — an async data-loading effect, not derivable state.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async PDF load; loading/error track the fetch lifecycle
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(
    () => () => {
      void taskRef.current?.destroy();
      taskRef.current = null;
    },
    [],
  );

  return (
    <div className="bg-surface-sunken relative h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <div className="text-foreground-tertiary absolute inset-0 flex items-center justify-center text-sm">
          Couldn&apos;t load this PDF.
        </div>
      )}
      <div
        ref={containerRef}
        className="flex h-full flex-col items-center gap-6 overflow-y-auto p-6"
      />
    </div>
  );
}
