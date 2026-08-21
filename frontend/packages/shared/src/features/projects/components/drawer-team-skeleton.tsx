import { Skeleton } from "@sico/ui";
import type * as React from "react";

import { drawerSectionLabel } from "./drawer-section-label";

/**
 * Team section skeleton for the project drawer: eyebrow + avatar-group preview +
 * Invite button. Traces the real section shape so it serves as both a building
 * block of `ProjectDrawerSkeleton` and a Suspense fallback. Presentational — the
 * consumer owns any `role="status"`.
 */
export function DrawerTeamSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {drawerSectionLabel()}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  );
}
