import { Skeleton } from "@sico/ui";
import type * as React from "react";

export type AssetDetailSkeletonProps = {
  /**
   * Which Detail-panel shape to trace on the right. `rich` (knowledge) has the
   * tag area + source-file rows; `simple` (experience / deliverable) is the
   * name + stacked created/operator layout. The left content card is the
   * same block for all three.
   */
  variant?: "rich" | "simple";
};

// The right Detail panel — `rich` mirrors the knowledge panel (name/summary,
// tags, source file, created time); `simple` mirrors the experience/deliverable
// meta panel (name + generated-by, then a stacked created/operator pair).
function renderPanel(variant: "rich" | "simple"): React.JSX.Element {
  if (variant === "simple") {
    return (
      <div className="flex flex-1 flex-col gap-8 p-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-44" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-6 w-56 rounded-lg" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-32" />
      </div>
    </div>
  );
}

/**
 * Content-shaped loading surface for {@link AssetDetail} — traces the two-column
 * layout so the page doesn't reflow on resolve (§6 dec 8: never a spinner). The
 * left content card is the same for all three asset kinds (a single block —
 * markdown body or file preview); only the right Detail panel differs by
 * `variant` (knowledge = rich, experience / deliverable = simple).
 */
export function AssetDetailSkeleton({
  variant = "rich",
}: AssetDetailSkeletonProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading asset"
      className="bg-surface-canvas flex h-full min-h-0"
    >
      <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1 px-5">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-4 w-16" />
        </div>
        {/* The content card — a text-shaped placeholder (heading + a few
            paragraphs of varying-width lines) rather than one solid block, so it
            reads as a document body. The real left content varies widely
            (markdown or file preview), so this only suggests prose, not an exact
            trace. Gutter matches the real markdown body (fluid px-4 →
            px-34 at ≥768px column width). */}
        <div className="@container flex min-h-0 flex-1 flex-col px-5 pt-0 pb-4">
          <div className="bg-surface-basic shadow-m flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div className="flex flex-col gap-8 px-4 py-11 @3xl:px-34">
              <Skeleton className="h-7 w-2/5" />
              <div className="flex flex-col gap-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-3/5" />
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-1/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="border-divider flex h-full w-90 shrink-0 flex-col border-l"
      >
        <div className="flex h-12 items-center justify-between px-5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="size-7" />
        </div>
        {renderPanel(variant)}
      </div>
    </div>
  );
}
