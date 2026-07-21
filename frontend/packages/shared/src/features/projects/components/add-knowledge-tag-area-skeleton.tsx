import { Skeleton } from "@sico/ui";
import type * as React from "react";

/**
 * Loading surface for the Add Knowledge tag area — a label + "Add tag"-sized
 * pill, so the dialog doesn't reflow when `useKnowledgeTagsQuery` resolves.
 */
export function AddKnowledgeTagAreaSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading knowledge tags"
      className="flex flex-col gap-3"
    >
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
    </div>
  );
}
