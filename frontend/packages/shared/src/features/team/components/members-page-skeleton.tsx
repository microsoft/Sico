import { Skeleton } from "@sico/ui";
import type * as React from "react";

import { WORKER_HEADERS } from "./dw-table";
import { HUMAN_HEADERS } from "./humans-table";
import type { MembersTab } from "./members-page";
import { MembersTableSkeleton } from "./members-table-skeleton";

/**
 * Page-level loading surface for the Members route — a `Skeleton` mirror of the
 * back bar + "Members" title + pill tabs + the card-wrapped member table, so the
 * page doesn't flash blank while the project-detail query (breadcrumb +
 * last-active) resolves. Reuses {@link MembersTableSkeleton} for the table so
 * the roster area matches the real second-stage load. The active tab's real
 * headers keep the placeholder columns aligned with what resolves. The root
 * `role="status"` carries the single loading intent; nested blocks are hidden.
 */
export function MembersPageSkeleton({
  activeTab,
}: {
  activeTab: MembersTab;
}): React.JSX.Element {
  const headers = activeTab === "workers" ? WORKER_HEADERS : HUMAN_HEADERS;
  return (
    <div
      role="status"
      aria-label="Loading members"
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
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
          <div className="bg-surface-basic shadow-m min-h-0 flex-1 overflow-hidden rounded-2xl">
            <MembersTableSkeleton
              headers={headers}
              label="Loading members"
              asNestedBlock
            />
          </div>
        </div>
      </div>
    </div>
  );
}
