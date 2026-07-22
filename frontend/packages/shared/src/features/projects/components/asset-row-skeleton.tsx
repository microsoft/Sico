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

import { Skeleton, TableCell } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import type * as React from "react";

import { CREATOR_MAX, PIN_LEFT, PIN_RIGHT } from "./pinned-columns";

/**
 * The 5 content-shaped cells of a single assets-table placeholder row, mirroring
 * the real `AssetRow` layout — ASSET NAME (icon + name) / TYPE (badge) / CREATOR
 * (avatar + name) / CREATED TIME / ACTIONS. Shared by both skeleton rows so they
 * stay byte-identical: the cold-load row in `AssetsTableSkeleton` and the
 * loading-more row appended in `AssetsTableRows`. The enclosing `<TableRow>`
 * (key, hover, test id, aria) differs per caller and stays at the call site —
 * it must carry `bg-surface-basic` so the pinned cells' `bg-inherit` has a fill.
 */
export function renderAssetSkeletonCells(): React.JSX.Element {
  return (
    <>
      <TableCell className={cn("px-6", PIN_LEFT)}>
        <div className="flex items-center gap-1.5">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-4 w-40" />
        </div>
      </TableCell>
      <TableCell className="px-6">
        <Skeleton className="h-5 w-16 rounded-full" />
      </TableCell>
      <TableCell className={cn("px-6", CREATOR_MAX)}>
        <div className="flex items-center gap-2">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </TableCell>
      <TableCell className="px-6">
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell className={cn("px-2 text-right", PIN_RIGHT)}>
        <Skeleton className="ml-auto size-6" />
      </TableCell>
    </>
  );
}
