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
