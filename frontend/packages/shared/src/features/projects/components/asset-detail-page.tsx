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

import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type JSX, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { AssetDetailContent } from "./asset-detail-content";
import { AssetDetailSkeleton } from "./asset-detail-skeleton";
import { ErrorView } from "../../../components/error-view";

type AssetType = "knowledge" | "experience" | "deliverable";

export type AssetDetailPageProps = {
  assetId: number;
  type: AssetType;
  projectId: number;
};

// Knowledge uses the rich skeleton (tags + source rows); experience/deliverable
// use the simple one (name + stacked meta). Derivable from `type`, so the route
// mounts this without choosing a variant.
const SKELETON_VARIANT = {
  knowledge: "rich",
  experience: "simple",
  deliverable: "simple",
} as const satisfies Record<AssetType, "rich" | "simple">;

/**
 * Route-mountable asset detail: owns the error boundary + suspense so the three
 * `$assetId` routes stay thin. `resetKeys` track project + asset so navigating
 * between assets recovers a failed boundary. `AssetDetailContent` must sit
 * inside this boundary — its imperative redirect is swallowed if thrown outside.
 */
export function AssetDetailPage({
  assetId,
  type,
  projectId,
}: AssetDetailPageProps): JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <ErrorBoundary
      FallbackComponent={ErrorView}
      onReset={reset}
      resetKeys={[projectId, assetId]}
    >
      <Suspense
        fallback={<AssetDetailSkeleton variant={SKELETON_VARIANT[type]} />}
      >
        <AssetDetailContent
          assetId={assetId}
          type={type}
          projectId={projectId}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
