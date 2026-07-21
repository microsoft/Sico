import { useNavigate } from "@tanstack/react-router";
import { type JSX, useEffect } from "react";

import { AssetDetail } from "./asset-detail";
import { AssetDetailSkeleton } from "./asset-detail-skeleton";
import {
  resolveAssetDetailGuard,
  useAssetDetailQuery,
} from "../hooks/use-asset-detail-query";

export type AssetDetailContentProps = {
  assetId: number;
  /** Which detail endpoint to read — the route fixes this, not a URL query. */
  type: "knowledge" | "experience" | "deliverable";
  /** Owning project — all three detail routes nest under `$projectId`. */
  projectId: number;
};

/**
 * Suspending body for both asset-detail routes. Runs the post-resolve readiness
 * guard (§3/§4 P4): a non-ready Knowledge asset (status≠3) redirects to its
 * project; a ready asset renders. The redirect runs imperatively from an effect
 * — a router redirect thrown in render is swallowed by the page ErrorBoundary
 * (I4 spike, react-router 1.169.2). Must sit inside the route's boundary.
 */
export function AssetDetailContent({
  assetId,
  type,
  projectId,
}: AssetDetailContentProps): JSX.Element {
  const navigate = useNavigate();
  const { data } = useAssetDetailQuery({ id: assetId, type });
  // Experience carries no `status`, so pass `{}` — the guard returns "ok" (§6
  // dec 3: experience skips the readiness gate). Knowledge carries `status`.
  const guard = resolveAssetDetailGuard(data.type === "knowledge" ? data : {});

  useEffect(() => {
    // Only Knowledge can be non-ready; redirect it back to its project.
    if (guard === "redirect") {
      void navigate({
        to: "/project/$projectId",
        params: { projectId: String(projectId) },
      });
    }
  }, [guard, navigate, projectId]);

  if (guard === "redirect") {
    return <AssetDetailSkeleton />;
  }
  return <AssetDetail asset={data} projectId={projectId} />;
}
