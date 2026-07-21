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
import type * as React from "react";

import { AssetContentCard } from "./asset-content-card";
import { AssetDetailLayout } from "./asset-detail-layout";
import { AssetDetailPanel } from "./asset-detail-panel";
import { Markdown } from "../../../components/markdown";
import { downloadFile } from "../../../utils/download-file";
import type { AssetDetail as AssetDetailData } from "../hooks/use-asset-detail-query";
import { useAssetMutation } from "../hooks/use-asset-mutation";

type KnowledgeDetail = Extract<AssetDetailData, { type: "knowledge" }>;

// The knowledge `…` overflow menu — lives in the shell's `actions` slot. Download
// shows only when the asset has a downloadable file (a LINK doc has no blob, so
// `onDownload` is omitted). A plain module-scope render helper (NOT a nested
// component) so the `AssetDetailKnowledge` body stays under the line cap.
function renderActions(
  onRequestDelete: () => void,
  onDownload?: () => void,
): React.JSX.Element {
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
            Download
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

export type AssetDetailKnowledgeProps = {
  asset: KnowledgeDetail;
  /** Owning project — always present for Knowledge (delete / retag / tag area). */
  projectId: number;
};

/**
 * Knowledge asset detail — a markdown body on the left and the rich Detail panel
 * (summary, tag area, source file) on the right, inside the shared
 * {@link AssetDetailLayout}. The route hands it an already-resolved,
 * already-guarded asset.
 */
export function AssetDetailKnowledge({
  asset,
  projectId,
}: AssetDetailKnowledgeProps): React.JSX.Element {
  const navigate = useNavigate();
  const { edit, remove } = useAssetMutation(projectId);

  // Chips read from `asset.tags` (the cache, optimistically rewritten by `edit`),
  // so the retag is a bare fire. Inline retag has no success toast by design, but
  // a silent failure is worse than a stale chip, so surface the error.
  const handleRetag = (next: number[]): void => {
    edit.mutate(
      { id: asset.id, tagIds: next },
      {
        onError: () => {
          toast.error("We couldn't update tags. Try again.");
        },
      },
    );
  };
  const handleDelete = (): void => {
    remove.mutate(
      { id: asset.id, type: "knowledge" },
      {
        onSuccess: () => {
          toast.success(`"${asset.name}" was deleted.`, { invert: true });
          void navigate({
            to: "/project/$projectId",
            params: { projectId: String(projectId) },
          });
        },
        onError: () => {
          toast.error("We couldn't delete this. Try again.");
        },
      },
    );
  };

  // A knowledge FILE carries its uploaded blob on `attachment.sasUrl` (a LINK
  // doc has none → no Download item). `downloadFile` scheme-gates the URL and
  // saves it under the file's real name.
  const sasUrl = asset.attachment?.sasUrl;
  const handleDownload = sasUrl
    ? (): void => {
        void downloadFile(sasUrl, asset.attachment?.name ?? asset.name);
      }
    : undefined;

  return (
    <AssetDetailLayout
      projectId={projectId}
      current={asset.name}
      leftBody={
        <div className="@container flex min-h-0 flex-1 flex-col px-5 pt-0 pb-4">
          <AssetContentCard>
            {/* Fluid reading gutter: px-34 at full page width (≥768px column),
                relaxing to px-4 once the column narrows so the body isn't
                crushed. Container-query on the column, not the viewport. */}
            <div className="px-4 py-11 @3xl:px-34">
              <Markdown content={asset.fullText} />
            </div>
          </AssetContentCard>
        </div>
      }
      rightPanel={
        <AssetDetailPanel
          asset={asset}
          projectId={projectId}
          tagIds={asset.tags.map((tag) => tag.id)}
          onRetag={handleRetag}
        />
      }
      actions={(onRequestDelete) =>
        renderActions(onRequestDelete, handleDownload)
      }
      confirm={{
        title: "Delete Knowledge",
        body: "Permanently remove access to this knowledge across your organization.",
        onConfirm: handleDelete,
        pending: remove.isPending,
      }}
    />
  );
}
