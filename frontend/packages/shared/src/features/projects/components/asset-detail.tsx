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
