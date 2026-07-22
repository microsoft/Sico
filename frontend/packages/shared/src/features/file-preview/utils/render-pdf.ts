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

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// pdfjs parses + rasterizes off the main thread; point it at the bundled worker
// chunk (Vite rewrites this URL at build time). Set once on module load — which,
// because this module is only reached through lazy-pdf-viewer's dynamic import,
// keeps pdfjs out of the main bundle.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Width-fit bounds (CSS px): never narrower than a phone column, never wider
// than an A4 page at 96dpi — the sidepane's comfortable reading width.
export const MIN_PAGE_WIDTH = 300;
export const MAX_PAGE_WIDTH = 794;

export function clampWidth(width: number): number {
  return Math.max(MIN_PAGE_WIDTH, Math.min(MAX_PAGE_WIDTH, width));
}

// cMap (character maps) + standard-font assets let pdfjs render CJK and
// non-embedded-font PDFs; the npm package doesn't ship them in the bundle, so
// each consuming app self-hosts them under `<BASE_URL>/pdfjs/` (mirrors legacy
// dwp). `BASE_URL` resolves at runtime to the app root, so the same shared
// viewer works whichever app mounts it. `cMapPacked` — the vendored cmaps are
// the compact `.bcmap` binaries, not the raw JSON form.
const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;
const CMAP_URL = `${PDFJS_ASSET_BASE}cmaps/`;
const STANDARD_FONT_DATA_URL = `${PDFJS_ASSET_BASE}standard_fonts/`;

// Returns the loading task (not just its promise) so the caller can `destroy()`
// it — that one call aborts the network *and* tears down the worker, covering
// both the still-loading and fully-loaded cases.
export function loadPdf(url: string): ReturnType<typeof pdfjsLib.getDocument> {
  return pdfjsLib.getDocument({
    url,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });
}

// Paint one page onto its own canvas, width-fit to `pageWidth` and sharpened for
// the device pixel ratio. pdfjs v6 owns the 2D context (`render({ canvas })`),
// so there's no `getContext("2d")!` — the DPR scale rides in via `transform`.
async function renderPage(
  page: PDFPageProxy,
  container: HTMLDivElement,
  pageWidth: number,
  dpr: number,
): Promise<void> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: pageWidth / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  canvas.className = "shadow-s mb-4";
  canvas.dataset.testid = "pdf-page";
  container.append(canvas);
  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
  await page.render({ canvas, viewport, transform }).promise;
}

/**
 * Paint every page of `pdf` into `container` as a vertical stack of canvases.
 * Re-entrant: the container is cleared with `replaceChildren()` (never
 * `innerHTML`) first, and an aborted `signal` (url swap, resize, unmount) stops
 * the loop between pages so a stale pass can't append orphaned canvases.
 */
export async function renderPdf(
  pdf: PDFDocumentProxy,
  container: HTMLDivElement,
  signal: AbortSignal,
  pageWidth: number,
): Promise<void> {
  container.replaceChildren();
  const dpr = window.devicePixelRatio || 1;
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (signal.aborted) {
      return;
    }
    const page = await pdf.getPage(pageNum);
    await renderPage(page, container, pageWidth, dpr);
  }
}
