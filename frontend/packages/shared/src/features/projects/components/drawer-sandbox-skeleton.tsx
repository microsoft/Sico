import { Skeleton } from "@sico/ui";
import type * as React from "react";

import { drawerSectionLabel } from "./drawer-section-label";

const SKELETON_DEVICE_COUNT = 2;

/**
 * Sandbox section skeleton for the project drawer: eyebrow + device rows (tile +
 * label/count) + View all. Building block of `ProjectDrawerSkeleton`.
 */
export function DrawerSandboxSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {drawerSectionLabel()}
      {Array.from({ length: SKELETON_DEVICE_COUNT }, (_, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
      <Skeleton className="h-4 w-16" />
    </div>
  );
}
