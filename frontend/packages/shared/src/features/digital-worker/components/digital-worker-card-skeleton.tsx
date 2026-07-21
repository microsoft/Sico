import { Skeleton } from "@sico/ui";
import type { ReactElement } from "react";

/** Single card placeholder for `<DigitalWorkersGridSkeleton>`. */
export function DigitalWorkerCardSkeleton(): ReactElement {
  return (
    <div
      aria-hidden="true"
      data-testid="digital-worker-card-skeleton"
      className="bg-surface-basic border-stroke-subtle-card-rest flex h-32 w-full flex-col items-start justify-between rounded-xl border p-5"
    >
      <div className="flex w-full items-center">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pl-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
      <div className="flex w-full items-center gap-1.5">
        <Skeleton className="size-3.5 shrink-0 rounded-sm" />
        <Skeleton className="h-3.5 w-1/4" />
      </div>
    </div>
  );
}
