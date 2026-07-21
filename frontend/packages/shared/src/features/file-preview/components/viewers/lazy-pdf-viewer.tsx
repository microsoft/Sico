import { Spinner } from "@sico/ui";
import { type JSX, lazy, Suspense } from "react";

// Dynamic import is the whole point: pdfjs-dist (and its worker) is a heavy dep
// that only this chunk pulls in, so it never reaches the main bundle — it loads
// on first PDF preview, not on app boot.
const PdfViewer = lazy(() => import("./pdf-viewer"));

export type LazyPdfViewerProps = {
  fileUrl: string;
};

/**
 * Suspense boundary around the pdfjs-backed `PdfViewer` — shows a spinner while
 * the viewer chunk downloads, mirroring the fill pattern of its peer viewers.
 */
export function LazyPdfViewer({ fileUrl }: LazyPdfViewerProps): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <PdfViewer fileUrl={fileUrl} />
    </Suspense>
  );
}
