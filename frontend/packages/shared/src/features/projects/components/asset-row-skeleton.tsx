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
