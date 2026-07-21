import { type JSX } from "react";

import { useFetchedText } from "../../hooks/use-fetched-text";
import { LoadingOverlay } from "../loading-overlay";
import { UnpreviewableState } from "../unpreviewable-state";

export type TextFileViewerProps = {
  fileUrl: string;
};

/**
 * Plain-text file subtype body (.txt) — fetches the file's text and renders it
 * VERBATIM in a `<pre>`. Unlike `MarkdownFileViewer`, the content is NOT run
 * through the Markdown renderer: a `.txt` is literal text, so markdown syntax
 * (`#`, `*`, `|`) must show as-is rather than be parsed. `{content}` in JSX is
 * React-escaped, so this never routes untrusted text into raw HTML.
 *
 * The fetch + replace-in-place (MP13) state machine is shared with
 * `MarkdownFileViewer` via `useFetchedText`; only the rendered body differs.
 */
export function TextFileViewer({ fileUrl }: TextFileViewerProps): JSX.Element {
  const { content, loading, error } = useFetchedText(fileUrl);

  if (error) {
    return <UnpreviewableState />;
  }

  return (
    <div className="@container relative flex-1 overflow-y-auto">
      {loading && <LoadingOverlay />}
      {/* Verbatim text: `whitespace-pre-wrap` keeps the file's newlines and
          spacing, `break-words` wraps long unbroken lines so they don't force a
          horizontal scroll. Mono font reads as a file, not prose. The gutter is
          fluid: px-4 in a narrow side-pane (container < 768px), px-34 at ≥768px
          to match the document body — container-query, so it tracks the pane. */}
      <pre
        data-testid="file-text"
        className="px-4 py-11 font-mono text-sm break-words whitespace-pre-wrap @3xl:px-34"
      >
        {content}
      </pre>
    </div>
  );
}
