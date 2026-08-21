import type { AssetDetail } from "./use-asset-detail-query";
import { useProjectPermission } from "../../rbac/hooks/use-project-permission";
import { ownsAsset } from "../components/assets-table-rows";
import type { AssetCreator } from "../types";

// Map a detail asset to the canonical `AssetCreator` the `.own` check reads.
// A Knowledge doc is created by a USER (`creatorUsername`); a Deliverable /
// Experience is produced by a DW, so the owner is the human operator that ran
// it (`extraInfo.agentInstance.operatorUsername`). Mirrors the list mappers.
function detailCreator(asset: AssetDetail): AssetCreator {
  if (asset.type === "knowledge") {
    return { kind: "user", username: asset.creatorUsername };
  }
  return {
    kind: "agent",
    operatorUsername: asset.extraInfo?.agentInstance?.operatorUsername,
  };
}

// Whether the current viewer may delete THIS asset on its detail page — the same
// gate the list uses: an admin deletes any asset; a member deletes only the ones
// they created. Returns false until the permission query settles (fail closed,
// matching the table), so the Delete item never briefly reads as enabled.
export function useAssetDeleteGate(
  asset: AssetDetail,
  projectId: number,
): boolean {
  const { canManageAsset, canManageAssetOwn, userEmail, isLoading } =
    useProjectPermission(projectId);
  if (isLoading) {
    return false;
  }
  return (
    canManageAsset ||
    (canManageAssetOwn && ownsAsset(detailCreator(asset), userEmail))
  );
}
