import { Button } from "@sico/ui";
import { useAtom } from "jotai";
import { PanelLeft } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { CollapsiblePanelShell } from "./collapsible-panel-shell";
import { ConfirmDialog } from "./confirm-dialog";
import { ProjectPageHeader } from "./project-page-header";
import { assetDetailPanelCollapsedAtom } from "../atoms/asset-detail-panel-atom";
import { useAssetDetailBack } from "../hooks/use-asset-detail-back";
import { useProjectDetailQuery } from "../hooks/use-project-query";

export type AssetDetailLayoutProps = {
  /** Owning project — drives the breadcrumb root + back-nav fallback. */
  projectId: number;
  /** Breadcrumb leaf: knowledge/experience name, deliverable filename. */
  current: string;
  /** Left column body, already wrapped in its reading gutter. */
  leftBody: React.ReactNode;
  /** Right "Detail" panel body (rich knowledge panel or simple meta panel). */
  rightPanel: React.ReactNode;
  /**
   * The `…` overflow menu. A render-prop because the Delete item must open the
   * confirm dialog this layout owns — the layout hands its open-trigger in.
   */
  actions: (onRequestDelete: () => void) => React.ReactNode;
  /** Delete-confirm copy + handler; the open/close visibility is owned here. */
  confirm: {
    title: string;
    body: string;
    onConfirm: () => void;
    pending: boolean;
  };
};

/**
 * Shared chrome for the three asset-detail pages (Knowledge / Experience /
 * Deliverable): the two-column shell, the breadcrumb header with the
 * collapse/restore control, the collapsible "Detail" rail, and the delete
 * confirm. It owns ONLY cross-type state (project name, back-nav, panel
 * collapse, confirm visibility); every type-specific node is supplied by the
 * caller. A real component (not a helper) so the shared hooks stay at a
 * component's top level.
 */
export function AssetDetailLayout({
  projectId,
  current,
  leftBody,
  rightPanel,
  actions,
  confirm,
}: AssetDetailLayoutProps): React.JSX.Element {
  const { data: project } = useProjectDetailQuery(projectId);
  const onBack = useAssetDetailBack(projectId);
  const [collapsed, setCollapsed] = useAtom(assetDetailPanelCollapsedAtom);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="bg-surface-canvas flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ProjectPageHeader
          label={project.name}
          current={current}
          onBack={onBack}
          rightSlot={
            collapsed ? (
              <Button
                variant="subtle"
                size="icon-sm"
                aria-label="Show panel"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeft />
              </Button>
            ) : undefined
          }
        />
        {leftBody}
      </div>
      {collapsed ? null : (
        <CollapsiblePanelShell
          title="Detail"
          onCollapse={() => setCollapsed(true)}
          actions={actions(() => setConfirmOpen(true))}
        >
          {rightPanel}
        </CollapsiblePanelShell>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirm.title}
        body={confirm.body}
        onConfirm={confirm.onConfirm}
        pending={confirm.pending}
      />
    </div>
  );
}
