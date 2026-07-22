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

import { Button } from "@sico/ui";
import { ArrowDownToLine } from "lucide-react";
import type { JSX } from "react";

import { downloadFile } from "../../../../utils/download-file";
import { UnpreviewableState } from "../unpreviewable-state";

// Only the Download label is viewer-specific; the heading/body are the shared
// unpreviewable copy.
const COPY = {
  download: "Download",
} as const;

export type UnsupportedViewerProps = {
  fileUrl: string;
  filename: string;
};

/**
 * Fallback body for the `unknown` subtype (and any file we can't render inline)
 * — the shared {@link UnpreviewableState} plus a Download action, ported from
 * legacy FileDrawer's no-preview branch. The header already carries its own
 * Download; this repeats it as the primary call-to-action where the body would
 * be. The download is self-contained (the same `downloadFile` util the header
 * uses), so a caller needn't thread a handler through `FilePreview` just for
 * this branch.
 */
export function UnsupportedViewer({
  fileUrl,
  filename,
}: UnsupportedViewerProps): JSX.Element {
  return (
    <UnpreviewableState
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void downloadFile(fileUrl, filename);
          }}
        >
          <ArrowDownToLine />
          {COPY.download}
        </Button>
      }
    />
  );
}
