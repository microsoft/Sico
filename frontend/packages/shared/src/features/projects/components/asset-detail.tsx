import type * as React from "react";

import { AssetDetailDeliverable } from "./asset-detail-deliverable";
import { AssetDetailExperience } from "./asset-detail-experience";
import { AssetDetailKnowledge } from "./asset-detail-knowledge";
import type { AssetDetail as AssetDetailData } from "../hooks/use-asset-detail-query";

export type AssetDetailProps = {
  asset: AssetDetailData;
  /** Owning project — drives back-nav for all three asset kinds. All detail
   *  routes nest under `$projectId`, so it is always in hand (required, matching
   *  `AssetDetailContent` and all three child viewers). */
  projectId: number;
};

/**
 * Read-only asset detail (§3/§4 P4) — a thin, hook-free type dispatcher; the
 * route owns the query. Knowledge → {@link AssetDetailKnowledge}; Experience →
 * {@link AssetDetailExperience}; Deliverable → {@link AssetDetailDeliverable}.
 * Each owns its own back-nav wiring so this stays a pure switch.
 */
export function AssetDetail({
  asset,
  projectId,
}: AssetDetailProps): React.JSX.Element {
  if (asset.type === "knowledge") {
    return <AssetDetailKnowledge asset={asset} projectId={projectId} />;
  }
  if (asset.type === "deliverable") {
    return <AssetDetailDeliverable asset={asset} projectId={projectId} />;
  }
  return <AssetDetailExperience asset={asset} projectId={projectId} />;
}

// Value (component above) + type-alias declaration merge onto one symbol, so the
// single barrel `export { AssetDetail }` carries both. Re-exporting a same-named
// value + type from two modules is a tsgo duplicate-identifier (TS2300/TS2323),
// so the merge is the only valid form; `no-redeclare` doesn't model it.
// eslint-disable-next-line @typescript-eslint/no-redeclare -- intentional value+type merge onto one exported name
export type AssetDetail = AssetDetailData;
