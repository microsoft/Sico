import type * as React from "react";

import { ConfirmDialog } from "./confirm-dialog";
import { EditAssetDialog } from "./edit-asset-dialog";
import { type AssetRowActions } from "../hooks/use-asset-row-actions";
import type { AssetRow } from "../types";

// Per-category delete-confirm copy. The dialog title/body name the kind being
// removed so the destructive action is unambiguous (a user may delete a
// Deliverable or Experience as readily as Knowledge).
const DELETE_COPY: Record<AssetRow["type"], { title: string; body: string }> = {
  knowledge: {
    title: "Delete Knowledge",
    body: "Permanently remove access to this knowledge across your organization.",
  },
  deliverable: {
    title: "Delete Deliverable",
    body: "Permanently remove this deliverable across your organization.",
  },
  experience: {
    title: "Delete Experience",
    body: "Permanently remove this experience across your organization.",
  },
};

// The two hoisted dialogs (one each, reused across rows). EditAssetDialog
// requires a non-null Knowledge asset, so it mounts only while one is set;
// ConfirmDialog stays mounted and opens off `deletingAsset`. Module-scope (no
// hooks) — mirrors `renderPanel` in asset-detail. State comes from
// `useAssetRowActions` (hooks/); this only wires it onto the dialogs.
export function renderRowDialogs({
  projectId,
  actions,
}: {
  projectId: number;
  actions: AssetRowActions;
}): React.JSX.Element {
  const { editingAsset, deletingAsset, deletingType, deletePending } = actions;
  // Title/body track the kind being deleted. While the dialog fades shut its
  // target has already cleared, so `deletingType` (the last delete target's
  // kind) keeps the copy stable instead of flashing a different kind's text.
  const copy = DELETE_COPY[deletingType];
  return (
    <>
      {editingAsset !== undefined && (
        <EditAssetDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              actions.closeEdit();
            }
          }}
          projectId={projectId}
          asset={editingAsset}
        />
      )}
      <ConfirmDialog
        open={deletingAsset !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            actions.closeDelete();
          }
        }}
        title={copy.title}
        body={copy.body}
        onConfirm={actions.confirmDelete}
        pending={deletePending}
      />
    </>
  );
}
