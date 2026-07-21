import {
  Skeleton,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import type * as React from "react";

import { renderAssetSkeletonCells } from "./asset-row-skeleton";
import { CREATOR_MAX, PIN_HEAD_LEFT, PIN_HEAD_RIGHT } from "./pinned-columns";

const SKELETON_ROW_COUNT = 5;

// Real header labels (not Skeleton bars) so the placeholder reads as the same
// 5-column assets table — ASSET NAME / TYPE / CREATOR / CREATED TIME / ACTIONS.
const COLUMN_HEADERS = [
  "ASSET NAME",
  "TYPE",
  "CREATOR",
  "CREATED TIME",
  "ACTIONS",
] as const;

export type AssetsTableSkeletonProps = {
  /**
   * When nested inside another skeleton that owns the live region (e.g.
   * `ProjectWorkspaceSkeleton`), render as a pure `aria-hidden` building block so
   * the page has a SINGLE `role="status"`. Standalone (the `AssetsTable` initial
   * load) it owns its own "Loading assets" status. Orthogonal to `variant`.
   */
  asNestedBlock?: boolean;
  /**
   * How much of the table chrome to mirror:
   * - `"full"` (default) — toolbar mirror + the card-wrapped table.
   * - `"bare"` — drop BOTH the toolbar mirror AND the table's card shell, so a
   *   persistent parent scroll card can wrap it (the `AssetsTable` cold load,
   *   where the card + infinite-scroll sentinel stay mounted across query
   *   states). A single `variant` names the valid shapes rather than a pair of
   *   booleans whose contradictory combinations would be nonsense.
   */
  variant?: "full" | "bare";
};

// The 5-column table card — the shape the real `renderAssetsTable` mounts inside
// `bg-surface-basic shadow-m rounded-2xl`, so the card doesn't appear on resolve.
// `bare` drops the card shell (a parent already provides it). Plain helper (not a
// component) so `react/no-multi-comp` never fires.
function renderSkeletonTableCard(bare: boolean): React.JSX.Element {
  const table = (
    // `group/table` mirrors the real table wrapper so the pinned columns'
    // `group-data-[scroll-*]/table:` fade variants resolve here too. The static
    // `true`/`true` defaults mean "at both edges" → solid pinned edges, which is
    // correct: the skeleton never scrolls, so it shows no frosted fade.
    <div
      className="group/table contents"
      data-scroll-start="true"
      data-scroll-end="true"
    >
      <Table aria-hidden="true">
        <TableHeader>
          <TableRow className="h-13">
            {COLUMN_HEADERS.map((label, index) => (
              <TableHead
                key={label}
                aria-label={label === "ACTIONS" ? "Actions" : undefined}
                // Mirror the real header's per-column sizing so the placeholder
                // columns line up 1:1 with resolved content: CREATOR caps at the
                // same 200px, ACTIONS hugs the row menu at `px-2` (not `px-6`).
                className={cn(
                  "h-13 px-6 text-sm",
                  label === "ACTIONS" && "px-2 text-right",
                  index === 0 && PIN_HEAD_LEFT,
                  label === "CREATOR" && CREATOR_MAX,
                  label === "ACTIONS" && PIN_HEAD_RIGHT,
                )}
              >
                {label === "ACTIONS" ? null : label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, idx) => (
            <TableRow
              key={idx}
              className="bg-surface-basic h-16 hover:bg-transparent"
              data-testid="assets-table-skeleton-row"
            >
              {renderAssetSkeletonCells()}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
  if (bare) {
    return table;
  }
  return (
    <div
      data-testid="assets-table-skeleton-card"
      className="bg-surface-basic shadow-m min-h-0 flex-1 overflow-y-auto rounded-2xl"
    >
      {table}
    </div>
  );
}

// The toolbar row above the table (`<AssetsToolbar>`): left filter Tabs, right
// search icon + Add Knowledge — placed so the toolbar doesn't pop in on resolve.
// Plain helper (not a component) so `react/no-multi-comp` never fires.
function renderSkeletonToolbar(): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <Skeleton className="h-8 w-72" />
      <div className="flex items-center gap-2">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Content-shaped loading surface for the assets table (§6 dec 8): a `Skeleton`
 * mirror of the toolbar + the 5-column table card — NEVER a spinner — so the
 * page does not reflow when real data arrives. See `variant` for the two
 * chrome shapes (full / bare).
 */
export function AssetsTableSkeleton({
  asNestedBlock = false,
  variant = "full",
}: AssetsTableSkeletonProps = {}): React.JSX.Element {
  const body = (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {variant === "full" ? renderSkeletonToolbar() : null}
      {renderSkeletonTableCard(variant === "bare")}
    </div>
  );
  if (asNestedBlock) {
    return (
      <div
        aria-hidden="true"
        data-testid="assets-table-skeleton"
        className="flex min-h-0 flex-1"
      >
        {body}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-label="Loading assets"
      data-testid="assets-table-skeleton"
      className="flex min-h-0 flex-1"
    >
      {body}
    </div>
  );
}
