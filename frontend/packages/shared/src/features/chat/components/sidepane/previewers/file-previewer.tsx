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

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@sico/ui";
import { ArrowDownToLine } from "lucide-react";
import { type JSX, useCallback } from "react";

import { downloadFile } from "../../../../../utils/download-file";
import { iconForFilename } from "../../../../../utils/file-icon";
import { FilePreview } from "../../../../file-preview/components/file-preview";
import type { SidepaneContent } from "../../../atoms/sidepane-atom";
import { AddToProjectButton } from "../add-to-project-button";
import { SidepaneHeader } from "../sidepane-header";

// Only the file variant of the union — the registry hands this previewer exactly
// that shape, so the prop is the narrowed branch, not the whole union.
type FileContent = Extract<SidepaneContent, { kind: "file" }>;

export type FilePreviewerProps = {
  content: FileContent;
};

// Verbatim §-copy (no i18n layer in this repo — peer previewers inline their own
// COPY const the same way).
const COPY = {
  download: "Download",
} as const;

/**
 * The `kind:"file"` previewer — header (titled with the filename, with a
 * Download action) over the shared `FilePreview`, which dispatches to a viewer by
 * the file's extension. The body is the reusable kernel (consumed by chat and
 * projects alike); this previewer only adds the chat sidepane header + download
 * action. The shell wraps this in an ErrorBoundary, so render faults are out of
 * scope.
 */
export function FilePreviewer({ content }: FilePreviewerProps): JSX.Element {
  const { filename, fileUrl, fileUri } = content;

  const handleDownload = useCallback(() => {
    void downloadFile(fileUrl, filename);
  }, [fileUrl, filename]);

  return (
    <div className="bg-surface-basic flex h-full flex-col overflow-y-auto">
      <SidepaneHeader
        icon={iconForFilename(filename)}
        title={filename}
        actionsSlot={
          <>
            {content.canAddToProject && (
              // Keyed by fileUri so the publish mutation's state can't leak when
              // the sidepane swaps the previewed file in place (same previewer
              // instance) — a fresh file gets a fresh, enabled button. Two
              // distinct files can't share a non-empty fileUri (it encodes the
              // blob path). An empty fileUri collides on the "" key across a
              // swap, but that's safe: an empty fileUri keeps the button
              // disabled, so there is no mutation state to leak.
              <AddToProjectButton
                key={fileUri ?? ""}
                fileUri={fileUri ?? ""}
                filename={filename}
              />
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="subtle"
                    size="icon-xs"
                    aria-label={COPY.download}
                    onClick={handleDownload}
                  >
                    <ArrowDownToLine className="size-4" />
                  </Button>
                }
              />
              <TooltipContent>{COPY.download}</TooltipContent>
            </Tooltip>
          </>
        }
      />
      <FilePreview fileUrl={fileUrl} filename={filename} />
    </div>
  );
}
