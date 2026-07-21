import { type JSX } from "react";

import { Markdown } from "../../../../components/markdown";
import { useFetchedText } from "../../hooks/use-fetched-text";
import { LoadingOverlay } from "../loading-overlay";
import { UnpreviewableState } from "../unpreviewable-state";

export type MarkdownFileViewerProps = {
  fileUrl: string;
};

/**
 * Markdown file subtype body — fetches the `.md` file's text and renders it
 * through the shared `Markdown` boundary (#189), never a re-implementation.
 * Unlike the in-memory `MarkdownPreviewer` (its markdown is already a string),
 * a file lives behind a URL, so this fetches it: spinner while pending, the
 * download-fallback state on failure.
 *
 * The fetch + replace-in-place (MP13) state machine is shared with
 * `TextFileViewer` via `useFetchedText`; only the rendered body differs.
 */
export function MarkdownFileViewer({
  fileUrl,
}: MarkdownFileViewerProps): JSX.Element {
  const { content, loading, error } = useFetchedText(fileUrl);

  if (error) {
    return <UnpreviewableState />;
  }

  return (
    <div className="@container relative flex-1 overflow-y-auto">
      {loading && <LoadingOverlay />}
      {/* Fluid reading gutter: a narrow side-pane (container < 768px) gets a
          minimal px-4 so the body isn't crushed; at ≥768px it returns to the
          px-34 document gutter shared with the asset-detail markdown bodies.
          Container-query (not viewport) so it tracks the pane's own width. The
          surface comes from the caller, internal prose typography from
          `Markdown`. */}
      <div
        data-testid="file-markdown"
        className="flex flex-col px-4 py-11 @3xl:px-34"
      >
        <Markdown content={content} />
      </div>
    </div>
  );
}
