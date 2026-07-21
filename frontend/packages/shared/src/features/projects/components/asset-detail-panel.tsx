import type * as React from "react";
import { createElement, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { AddKnowledgeTagArea } from "./add-knowledge-tag-area";
import { AddKnowledgeTagAreaSkeleton } from "./add-knowledge-tag-area-skeleton";
import { iconForFilename } from "../../../utils/file-icon";
import { logger } from "../../../utils/logger";
import { safeIconUri } from "../../../utils/safe-icon-uri";
import type { AssetDetail as AssetDetailData } from "../hooks/use-asset-detail-query";
import { DocumentTypeSchema } from "../schemas/asset";
import { formatDateTime } from "../utils/format-date-time";

type KnowledgeDetail = Extract<AssetDetailData, { type: "knowledge" }>;

const LABEL_CLASS = "text-foreground-secondary leading-body text-sm";

export type AssetDetailPanelProps = {
  asset: KnowledgeDetail;
  projectId: number;
  tagIds: number[];
  onRetag: (next: number[]) => void;
};

// Source file chip (Figma 19230:55687) — opens the FILE blob (`attachment.sasUrl`)
// or the LINK `linkUrl` in a new tab. The href is scheme-gated via `safeIconUri`
// (http(s)/same-origin only) so a stored `javascript:`/`data:` URL can't execute
// on click (XSS); a rejected href renders the chip read-only. No name → omitted.
function renderSourceFile(asset: KnowledgeDetail): React.JSX.Element | null {
  const isLink = asset.documentType === DocumentTypeSchema.enum.LINK;
  const rawHref = isLink ? asset.linkUrl : asset.attachment?.sasUrl;
  const href = safeIconUri(rawHref ?? undefined);
  const name = asset.attachment?.name ?? (isLink ? asset.linkUrl : null);
  if (!name) {
    return null;
  }
  const chip = (
    <div className="border-divider bg-surface-basic hover:bg-surface-sunken flex h-6 w-56 items-center gap-1 rounded-lg border px-1 transition-colors">
      {createElement(iconForFilename(name), {
        className: "text-icon-primary size-4 shrink-0",
      })}
      <span className="text-foreground-primary truncate text-xs">{name}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className={LABEL_CLASS}>Source file</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title="View"
          className="w-fit"
        >
          {chip}
        </a>
      ) : (
        chip
      )}
    </div>
  );
}

/**
 * Knowledge "Detail" panel BODY — the rich content (name, summary, tag area,
 * source file, created time) that sits inside the shared collapsible
 * `CollapsiblePanelShell`. The shell owns the section chrome + collapse +
 * actions; this is the scrolling body only.
 */
export function AssetDetailPanel({
  asset,
  projectId,
  tagIds,
  onRetag,
}: AssetDetailPanelProps): React.JSX.Element {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-foreground-primary leading-body-2 min-w-0 truncate font-medium">
          {asset.name}
        </p>
        <p className="text-foreground-primary leading-body-2">
          {asset.summary}
        </p>
        <p className={LABEL_CLASS}>Uploaded by {asset.creatorUsername}</p>
      </div>
      {/* A tag-source failure must not escalate to the page-level ErrorView —
          the local boundary swallows it so only the tag area drops out. Log so
          the silent fallback still leaves a trace. */}
      <ErrorBoundary
        fallback={null}
        onError={(error) => logger.error("tag area failed", { error })}
      >
        <Suspense fallback={<AddKnowledgeTagAreaSkeleton />}>
          <AddKnowledgeTagArea
            projectId={projectId}
            value={tagIds}
            onChange={onRetag}
            labelClassName={`${LABEL_CLASS} font-normal`}
          />
        </Suspense>
      </ErrorBoundary>
      {renderSourceFile(asset)}
      <div className="flex flex-col gap-2">
        <p className={LABEL_CLASS}>Created time</p>
        <p className="text-foreground-primary leading-body-2">
          {formatDateTime(asset.createdAt)}
        </p>
      </div>
    </>
  );
}
