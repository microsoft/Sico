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
import type * as React from "react";

const SKELETON_ROW_COUNT = 5;

// Real labels (not Skeleton bars) so the placeholder reads as the same table.
// ACTIONS splits out to right-align over the trigger, matching the real table.
const PLAIN_HEADERS = ["KNOWLEDGE TAG", "DESCRIPTION"] as const;

/**
 * Loading mirror of the page shell — a real 3-column table placeholder (not a
 * spinner) so the layout doesn't reflow when the query resolves.
 */
export function KnowledgeTagsSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading knowledge tags"
      className="flex h-full min-h-0 flex-col"
    >
      <div
        aria-hidden="true"
        className="flex h-12 shrink-0 items-center gap-1 px-5"
      >
        <Skeleton className="size-6 rounded-md" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div
        aria-hidden="true"
        className="flex min-h-0 flex-1 flex-col gap-6 px-5 pt-11 pb-10 lg:px-16"
      >
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-8 w-44" />
        </div>
        <div className="bg-surface-basic shadow-m min-h-0 flex-1 overflow-y-auto rounded-2xl">
          <Table>
            <TableHeader>
              <TableRow className="h-13">
                {PLAIN_HEADERS.map((label) => (
                  <TableHead key={label} className="h-13 px-6 text-sm">
                    {label}
                  </TableHead>
                ))}
                <TableHead className="h-13 px-6 text-right text-sm">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: SKELETON_ROW_COUNT }, (_, idx) => (
                <TableRow
                  key={idx}
                  className="h-16 hover:bg-transparent"
                  data-testid="knowledge-tags-skeleton-row"
                >
                  <TableCell className="w-72 max-w-72 px-6">
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell className="px-6">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                  <TableCell className="px-6">
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
