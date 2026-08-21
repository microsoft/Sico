import { Skeleton } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import type * as React from "react";

import { drawerSectionLabel } from "./drawer-section-label";

const SKELETON_CHIP_WIDTHS = ["w-32", "w-20", "w-28"] as const;

/**
 * Knowledge-tags section skeleton for the project drawer: eyebrow + chips.
 * Serves as both a building block of `ProjectDrawerSkeleton` and the Suspense
 * fallback for the self-fetching knowledge section.
 */
export function DrawerKnowledgeSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {drawerSectionLabel()}
      <div className="flex flex-wrap gap-2">
        {SKELETON_CHIP_WIDTHS.map((width) => (
          <Skeleton key={width} className={cn("h-6 rounded-sm", width)} />
        ))}
      </div>
    </div>
  );
}
