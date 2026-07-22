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
