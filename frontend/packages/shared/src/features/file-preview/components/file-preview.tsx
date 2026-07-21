import type { JSX } from "react";

import { safeIconUri } from "../../../utils/safe-icon-uri";
import { fileSubtype } from "../utils/file-subtype";
import { HtmlFileViewer } from "./viewers/html-file-viewer";
import { ImageViewer } from "./viewers/image-viewer";
import { LazyGlbViewer } from "./viewers/lazy-glb-viewer";
import { LazyPdfViewer } from "./viewers/lazy-pdf-viewer";
import { MarkdownFileViewer } from "./viewers/markdown-file-viewer";
import { OfficeViewer } from "./viewers/office-viewer";
import { TextFileViewer } from "./viewers/text-file-viewer";
import { UnsupportedViewer } from "./viewers/unsupported-viewer";
import { VideoViewer } from "./viewers/video-viewer";

export type FilePreviewProps = {
  fileUrl: string;
  filename: string;
};

/**
 * The header-less body of a file preview — dispatches to a viewer by the file's
 * extension. `fileSubtype` is the single source of which viewer renders; every
 * subtype routes to a real viewer (image/video/office/markdown/html zero-dep;
 * pdf/glb code-split via their Lazy boundaries), unknown is the download
 * fallback. Extracted out of the chat previewer so both chat and projects can
 * mount the same body under their own header. The shell wraps callers in an
 * ErrorBoundary, so render faults are out of scope.
 */
export function FilePreview({
  fileUrl,
  filename,
}: FilePreviewProps): JSX.Element {
  // Single scheme/origin gate for the whole body: `fileUrl` is an agent-authored
  // (untrusted) URL that fans out to every viewer's `fetch`/`<img>`/`<video>`/
  // pdfjs/Babylon sink. `fetch` defaults to same-origin credentials, so a
  // relative side-effect URL (`/api/admin/do.md?x=1`) would be a credentialed GET —
  // gate once here, the same http(s)-only allowlist `downloadFile` uses, so a
  // poisoned URL can never reach a sink. A blocked url falls back to the
  // download branch (whose button re-gates via `safeIconUri`, failing safe).
  if (safeIconUri(fileUrl) === undefined) {
    return <UnsupportedViewer fileUrl={fileUrl} filename={filename} />;
  }

  const subtype = fileSubtype(fileUrl);
  switch (subtype) {
    case "image":
      return <ImageViewer fileUrl={fileUrl} alt={filename} />;
    case "video":
      return <VideoViewer fileUrl={fileUrl} />;
    case "office":
      return <OfficeViewer fileUrl={fileUrl} />;
    case "pdf":
      return <LazyPdfViewer fileUrl={fileUrl} />;
    case "markdown":
      return <MarkdownFileViewer fileUrl={fileUrl} />;
    case "text":
      return <TextFileViewer fileUrl={fileUrl} />;
    case "html":
      return <HtmlFileViewer fileUrl={fileUrl} />;
    case "glb":
      return <LazyGlbViewer fileUrl={fileUrl} />;
    case "unknown":
      return <UnsupportedViewer fileUrl={fileUrl} filename={filename} />;
    default:
      // Exhaustiveness guard: a new FileSubtype must add a case above, else
      // `satisfies never` fails to compile here.
      subtype satisfies never;
      return <UnsupportedViewer fileUrl={fileUrl} filename={filename} />;
  }
}
