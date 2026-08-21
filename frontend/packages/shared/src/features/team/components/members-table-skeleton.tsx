import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sico/ui";
import type * as React from "react";

const SKELETON_ROW_COUNT = 4;

export type MembersTableSkeletonProps = {
  /** Real column labels (e.g. NAME / ROLE / LAST ACTIVE) — rendered as text so
   * the placeholder reads as the same table it precedes; ACTIONS is appended
   * right-aligned to mirror both member tables. */
  headers: readonly string[];
  /** Skeleton status label, e.g. "Loading members". */
  label: string;
  /** When nested inside a parent that already owns the loading `role="status"`
   * (e.g. `MembersPageSkeleton`), render as a pure `aria-hidden` block so the
   * page has a SINGLE status region. Standalone (a tab's own loading state) it
   * owns its own status. */
  asNestedBlock?: boolean;
};

// One placeholder row's CELLS: an avatar + name in the first cell, a short bar
// for each remaining data column, and an icon-sized bar in the trailing ACTIONS
// cell — mirrors the real HumanRow / DwRow shape so nothing reflows on resolve.
// Exported (cells only, no <TableRow>) so a table can append a "loading more"
// row while draining later pages without swapping the whole table for a skeleton.
export function renderMembersSkeletonCells(
  colCount: number,
): React.JSX.Element {
  return (
    <>
      <TableCell className="px-6">
        <div className="flex items-center gap-2">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      </TableCell>
      {Array.from({ length: colCount - 1 }, (_, idx) => (
        <TableCell key={idx} className="px-6">
          <Skeleton className="h-4 w-20" />
        </TableCell>
      ))}
      <TableCell className="px-6 text-right">
        <Skeleton className="ml-auto size-6" />
      </TableCell>
    </>
  );
}

function renderRow(colCount: number, key: number): React.JSX.Element {
  return (
    <TableRow key={key} className="h-14 hover:bg-transparent">
      {renderMembersSkeletonCells(colCount)}
    </TableRow>
  );
}

/**
 * Content-shaped loading surface for the two member tables (§6 dec 8: never a
 * spinner). Traces the same header row + `h-14` rows the real Humans / Digital
 * workers tables mount, so the page doesn't reflow when the roster resolves.
 */
export function MembersTableSkeleton({
  headers,
  label,
  asNestedBlock = false,
}: MembersTableSkeletonProps): React.JSX.Element {
  return (
    <div
      role={asNestedBlock ? undefined : "status"}
      aria-label={asNestedBlock ? undefined : label}
      aria-hidden={asNestedBlock ? true : undefined}
    >
      <Table aria-hidden="true">
        <TableHeader>
          <TableRow className="h-13 hover:bg-transparent">
            {headers.map((head) => (
              <TableHead key={head} className="h-13 px-6 text-sm">
                {head}
              </TableHead>
            ))}
            <TableHead className="h-13 px-6 text-right text-sm">
              ACTIONS
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, idx) =>
            renderRow(headers.length, idx),
          )}
        </TableBody>
      </Table>
    </div>
  );
}
