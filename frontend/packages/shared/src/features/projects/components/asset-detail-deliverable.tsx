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

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { Download, Ellipsis, Trash2 } from "lucide-react";
import { type JSX } from "react";

import { AssetContentCard } from "./asset-content-card";
import { AssetDetailLayout } from "./asset-detail-layout";
import { AssetDetailMetaPanel } from "./asset-detail-meta-panel";
import { MessageState } from "../../../components/message-state";
import { downloadFile } from "../../../utils/download-file";
import { UNPREVIEWABLE_ILLUSTRATION } from "../../file-preview";
import { FilePreview } from "../../file-preview/components/file-preview";
import type { AssetDetail as AssetDetailData } from "../hooks/use-asset-detail-query";
import { useAssetMutation } from "../hooks/use-asset-mutation";

type DeliverableDetail = Extract<AssetDetailData, { type: "deliverable" }>;

export type AssetDetailDeliverableProps = {
  asset: DeliverableDetail;
  /** Owning project — the back-fallback target when there's no history. */
  projectId: number;
};

const COPY = {
  download: "Download",
  unavailableHeading: "This file isn't available.",
  unavailableBody: "The deliverable has no file to preview or download.",
} as const;

// The deliverable `…` overflow menu — Download (when the file exists) + Delete,
// in the shell's `actions` slot. A plain module-scope render helper (NOT a nested
// component) so the component body stays under the line cap.
function renderActions(
  onRequestDelete: () => void,
  onDownload?: () => void,
): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="subtle" size="icon-sm" aria-label="Asset actions" />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onDownload ? (
          <DropdownMenuItem onClick={onDownload}>
            <Download />
            {COPY.download}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onRequestDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Delete the deliverable, then toast + navigate back to the project on success
// (keep the user on the page on failure so they can retry). Module-scope (no
// hooks) so the component body stays under the line cap — mirrors
// `runDelete` in use-asset-row-actions.
function runDeliverableDelete(
  remove: ReturnType<typeof useAssetMutation>["remove"],
  args: { assetId: number; projectId: number; filename: string },
  navigate: ReturnType<typeof useNavigate>,
): void {
  remove.mutate(
    { id: args.assetId, type: "deliverable" },
    {
      onSuccess: () => {
        toast.success(`"${args.filename}" was deleted.`, { invert: true });
        void navigate({
          to: "/project/$projectId",
          params: { projectId: String(args.projectId) },
        });
      },
      onError: () => {
        toast.error("We couldn't delete this. Try again.");
      },
    },
  );
}

// The file card — FilePreview renders FULL-WIDTH (a PDF/image/video preview
// doesn't suit the markdown reading gutter), or an explicit unavailable state
// when there's no SAS url. Module-scope (no hooks) so the body stays short.
function renderDeliverableFile(
  filename: string,
  fileSasUrl: string | null | undefined,
): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-0 pb-4">
      <AssetContentCard>
        {fileSasUrl ? (
          <FilePreview fileUrl={fileSasUrl} filename={filename} />
        ) : (
          <MessageState
            fill
            testId="deliverable-unavailable"
            illustrationUrl={UNPREVIEWABLE_ILLUSTRATION.url}
            illustrationWidth={UNPREVIEWABLE_ILLUSTRATION.width}
            illustrationHeight={UNPREVIEWABLE_ILLUSTRATION.height}
            heading={COPY.unavailableHeading}
            body={COPY.unavailableBody}
          />
        )}
      </AssetContentCard>
    </div>
  );
}

/**
 * Full-page deliverable preview — the published file a Digital Worker produced,
 * opened from the project's Deliverable tab. Renders the shared `FilePreview`
 * on the left and the simple Detail panel (whose `…` menu carries Download +
 * Delete) on the right, inside the shared {@link AssetDetailLayout}. The route
 * hands it an already-resolved id; the query suspends.
 */
export function AssetDetailDeliverable({
  asset,
  projectId,
}: AssetDetailDeliverableProps): JSX.Element {
  const navigate = useNavigate();
  const { remove } = useAssetMutation(projectId);
  const fileSasUrl = asset.fileSasUrl;
  const filename = asset.fileName;

  const handleDownload = fileSasUrl
    ? (): void => {
        void downloadFile(fileSasUrl, filename);
      }
    : undefined;

  return (
    <AssetDetailLayout
      projectId={projectId}
      current={filename}
      leftBody={renderDeliverableFile(filename, fileSasUrl)}
      rightPanel={
        <AssetDetailMetaPanel
          fileName={asset.fileName}
          createdAt={asset.createdAt}
          dwName={asset.extraInfo?.agentInstance?.agentName}
          operator={asset.creatorUsername ?? undefined}
        />
      }
      actions={(onRequestDelete) =>
        renderActions(onRequestDelete, handleDownload)
      }
      confirm={{
        title: "Delete Deliverable",
        body: "Permanently remove this deliverable across your organization.",
        onConfirm: () =>
          runDeliverableDelete(
            remove,
            { assetId: asset.id, projectId, filename },
            navigate,
          ),
        pending: remove.isPending,
      }}
    />
  );
}
