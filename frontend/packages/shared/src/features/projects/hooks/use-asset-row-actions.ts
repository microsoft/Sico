import { toast } from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { useAssetMutation } from "./use-asset-mutation";
import { assertNever } from "../../../utils/assert-never";
import { safeIconUri } from "../../../utils/safe-icon-uri";
import { type AssetActionKind } from "../components/asset-row";
import type { AssetRow as AssetRowData, KnowledgeRow } from "../types";

type Navigate = ReturnType<typeof useNavigate>;

// Navigable rows only (asset-row gates the call). Each opens under its project:
// Knowledge (`/project/$projectId/knowledge/$id`), Deliverable, and the
// read-only Experience playbook (`/project/$projectId/experience/$id`).
function navigateToAsset(
  navigate: Navigate,
  projectId: number,
  row: AssetRowData,
): void {
  if (row.type === "knowledge") {
    void navigate({
      to: "/project/$projectId/knowledge/$assetId",
      params: { projectId: String(projectId), assetId: String(row.id) },
    });
    return;
  }
  // A deliverable opens a full-page preview (FilePreview renders its file inline),
  // under the project like Knowledge — no longer a raw new-tab open.
  if (row.type === "deliverable") {
    void navigate({
      to: "/project/$projectId/deliverable/$assetId",
      params: { projectId: String(projectId), assetId: String(row.id) },
    });
    return;
  }
  void navigate({
    to: "/project/$projectId/experience/$assetId",
    params: { projectId: String(projectId), assetId: String(row.id) },
  });
}

// Render-time http(s) allow-list — guards the `javascript:` surface (§3 edge
// case) before handing the URL to the browser.
function openSafeLink(linkUrl: string | null | undefined): void {
  const safe = safeIconUri(linkUrl ?? undefined);
  if (safe) {
    window.open(safe, "_blank", "noopener,noreferrer");
  }
}

// Save a row's file straight from the browser. Knowledge FILE rows pass a
// same-origin `attachment.sasUrl` (`/storage/*`); Deliverable rows pass a
// backend-issued `fileSasUrl` on a cross-origin blob host. Scheme-gated through
// `safeIconUri` (http(s) only) so a poisoned URL can't smuggle a `javascript:`
// payload. A transient `<a download>` saves the same-origin blob under its real
// filename. `target="_blank"` is the cross-origin fallback: a browser ignores
// `download` (and the filename) across origins, so without it a deliverable
// whose SAS response lacks `Content-Disposition: attachment` would navigate the
// current tab and tear down the SPA — the new tab degrades to a plain open.
function downloadFile(sasUrl: string | null | undefined, name: string): void {
  const safe = safeIconUri(sasUrl ?? undefined);
  if (!safe) {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = safe;
  anchor.download = name;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

// ConfirmDialog signals intent only; close on success (mirrors asset-detail).
// `useAssetMutation` invalidates the assets list, so the table self-refreshes.
// Keep the confirm open on failure so the user can retry (silent failure is
// worse than a frozen dialog). Works for any asset kind — `useAssetMutation`
// routes the delete to the per-category endpoint off `asset.type`.
function runDelete(
  remove: ReturnType<typeof useAssetMutation>["remove"],
  asset: AssetRowData,
  onDone: () => void,
): void {
  remove.mutate(
    { id: asset.id, type: asset.type },
    {
      onSuccess: () => {
        toast.success(`"${asset.name}" was deleted.`, { invert: true });
        onDone();
      },
      onError: () => {
        toast.error("We couldn't delete this. Try again.");
      },
    },
  );
}

// A Knowledge row's non-delete actions (delete is handled universally by the
// caller). Module-scope (no hooks) so `useAssetRowActions` stays under the line
// ceiling. `setEditing` opens the edit dialog; download/open-link fire directly.
function runKnowledgeAction(
  row: KnowledgeRow,
  kind: Exclude<AssetActionKind, "delete">,
  setEditing: (row: KnowledgeRow) => void,
): void {
  switch (kind) {
    case "edit":
      setEditing(row);
      break;
    case "open-link":
      openSafeLink(row.linkUrl);
      break;
    case "download":
      // The uploaded blob, downloaded straight from the browser (no backend
      // service). `attachment.name` carries the real filename + extension.
      downloadFile(row.attachment?.sasUrl, row.attachment?.name ?? row.name);
      break;
    default:
      assertNever(kind);
  }
}

// The row-interaction surface (§3) owned away from the component body so it
// stays under the line ceiling — mirrors `useDismissedHints`. Tracks the
// Edit / Delete dialog targets, navigates on row-open, and runs the delete
// mutation; `renderRowDialogs` (components/) wires these onto the dialogs.
export type AssetRowActions = {
  editingAsset: KnowledgeRow | undefined;
  deletingAsset: AssetRowData | undefined;
  // The kind whose delete-confirm copy to show. Holds the last delete target's
  // `type` so the dialog title doesn't flash a different kind's copy during the
  // close transition, when `deletingAsset` has already cleared.
  deletingType: AssetRowData["type"];
  deletePending: boolean;
  handleOpen: (row: AssetRowData) => void;
  handleAction: (row: AssetRowData, kind: AssetActionKind) => void;
  confirmDelete: () => void;
  closeEdit: () => void;
  closeDelete: () => void;
};

export function useAssetRowActions(projectId: number): AssetRowActions {
  const navigate = useNavigate();
  const { remove } = useAssetMutation(projectId);
  const [editingAsset, setEditingAsset] = useState<KnowledgeRow | undefined>(
    undefined,
  );
  const [deletingAsset, setDeletingAsset] = useState<AssetRowData | undefined>(
    undefined,
  );
  // Survives the dialog's close transition: `deletingAsset` clears the instant
  // a delete resolves, but the ConfirmDialog fades out over ~100ms, so reading
  // its `type` directly would flash the fallback kind's copy. Written in the
  // event handler (not render) so the ref tracks the live target.
  const lastDeletingType = useRef<AssetRowData["type"]>("knowledge");

  const handleAction = (row: AssetRowData, kind: AssetActionKind): void => {
    // Delete is universal — every category can be removed; the row carries its
    // `type`, which `useAssetMutation` routes to the right endpoint.
    if (kind === "delete") {
      lastDeletingType.current = row.type;
      setDeletingAsset(row);
      return;
    }
    if (row.type === "knowledge") {
      runKnowledgeAction(row, kind, setEditingAsset);
    } else if (row.type === "deliverable" && kind === "download") {
      // A deliverable's only non-delete action is downloading its published
      // file (`fileSasUrl`, scheme-gated by `downloadFile`).
      downloadFile(row.fileSasUrl, row.name);
    }
    // Experience has no non-delete actions (its body is read-only).
  };

  const confirmDelete = (): void => {
    if (deletingAsset) {
      runDelete(remove, deletingAsset, () => setDeletingAsset(undefined));
    }
  };

  return {
    editingAsset,
    deletingAsset,
    deletingType: deletingAsset?.type ?? lastDeletingType.current,
    deletePending: remove.isPending,
    handleOpen: (row) => navigateToAsset(navigate, projectId, row),
    handleAction,
    confirmDelete,
    closeEdit: () => setEditingAsset(undefined),
    closeDelete: () => setDeletingAsset(undefined),
  };
}
