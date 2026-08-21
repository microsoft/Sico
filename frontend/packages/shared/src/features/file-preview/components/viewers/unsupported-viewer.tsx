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
