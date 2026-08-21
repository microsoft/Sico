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

import { DEVICE_HEADERS } from "./devices-table";

const SKELETON_ROW_COUNT = 6;

// One placeholder row tracing the real DevicesTable columns (DEVICE / TYPE /
// ASSIGNED WORKER / STATUS / ACTIONS) so nothing reflows when the list resolves.
function renderRow(key: number): React.JSX.Element {
  return (
    <TableRow key={key} className="h-14 hover:bg-transparent">
      {DEVICE_HEADERS.map((head) => (
        <TableCell key={head} className="px-6">
          <Skeleton className="h-4 w-24" />
        </TableCell>
      ))}
      <TableCell className="px-6">
        <Skeleton className="h-5 w-16 rounded-full" />
      </TableCell>
      <TableCell className="px-6 text-right">
        <Skeleton className="ml-auto size-6" />
      </TableCell>
    </TableRow>
  );
}

/**
 * Page-level loading surface for the Sandbox route — a `Skeleton` mirror of the
 * back bar + "Sandbox" title + status pills + the card-wrapped devices table, so
 * the page doesn't flash blank while the project-detail + devices queries
 * resolve. Mirrors {@link MembersPageSkeleton}; the root `role="status"` carries
 * the single loading intent, nested blocks are `aria-hidden`.
 */
export function SandboxPageSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading devices"
      className="bg-surface-canvas flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="flex h-12 shrink-0 items-center gap-1 px-5"
      >
        <Skeleton className="size-6 rounded-md" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div
        aria-hidden="true"
        className="flex min-h-0 flex-1 flex-col gap-6 px-5 pt-11 pb-10 lg:px-16"
      >
        <Skeleton className="h-9 w-40" />
        <div className="flex min-h-0 flex-1 flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-8 w-56 rounded-lg" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
          <div className="bg-surface-basic shadow-m min-h-0 flex-1 overflow-hidden rounded-2xl">
            <Table aria-hidden="true">
              <TableHeader>
                <TableRow className="h-13 hover:bg-transparent">
                  {DEVICE_HEADERS.map((head) => (
                    <TableHead key={head} className="h-13 px-6 text-sm">
                      {head}
                    </TableHead>
                  ))}
                  <TableHead className="h-13 px-6 text-sm">STATUS</TableHead>
                  <TableHead className="h-13 px-6 text-right text-sm">
                    ACTIONS
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: SKELETON_ROW_COUNT }, (_, idx) =>
                  renderRow(idx),
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
