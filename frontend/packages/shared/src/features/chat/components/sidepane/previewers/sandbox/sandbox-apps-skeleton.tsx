import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sico/ui";
import { type JSX } from "react";

const SKELETON_ROW_COUNT = 5;

// Real header labels (not Skeleton bars) so the placeholder reads as the same
// table and the layout does not reflow when the query resolves.
const HEADERS = ["Name", "Version"] as const;

// Full-panel loading mirror of <SandboxAppsContent>: the manage-apps header bar,
// the "All Apps" title, the tabs/install-button row, and the app table are all
// placeholdered so the whole panel — not just the table — reads as loading and
// keeps its shape while the query resolves (mirrors the projects feature's
// full-shell skeletons). The header controls render as inert Skeleton squares
// here; the real, interactive ManageAppsHeader appears once content resolves.
export function SandboxAppsSkeleton(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading apps"
      className="bg-surface-basic flex h-full flex-col"
    >
      <div
        aria-hidden="true"
        className="flex items-center justify-between gap-2 px-4 pt-4 pb-2"
      >
        <Skeleton className="size-7 shrink-0 rounded-md" />
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-11 py-6">
        <Skeleton aria-hidden="true" className="h-9 w-40" />
        <div
          aria-hidden="true"
          className="flex items-center justify-between gap-2"
        >
          <span />
          <Skeleton className="h-9 w-28" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {HEADERS.map((label) => (
                  <TableHead key={label} className="text-sm">
                    {label}
                  </TableHead>
                ))}
                <TableHead className="text-right text-sm">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-hidden="true">
              {Array.from({ length: SKELETON_ROW_COUNT }, (_, idx) => (
                <TableRow
                  key={idx}
                  className="h-16 hover:bg-transparent"
                  data-testid="apps-skeleton-row"
                >
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Skeleton className="size-8 shrink-0 rounded-lg" />
                      <Skeleton className="h-4 w-32" />
                    </span>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto size-6" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
