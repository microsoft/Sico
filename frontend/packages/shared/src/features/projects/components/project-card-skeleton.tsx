import { Skeleton } from "@sico/ui";
import type * as React from "react";

/** Single card placeholder for `<ProjectsGridSkeleton>`. */
export function ProjectCardSkeleton(): React.JSX.Element {
  return (
    <article
      aria-hidden="true"
      data-testid="project-card-skeleton"
      className="bg-surface-basic border-stroke-subtle-card-rest flex w-full flex-col gap-6 rounded-xl border p-5"
    >
      <div className="flex w-full items-center justify-between">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex shrink-0 items-center gap-1.5">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="size-6 rounded-full" />
        </div>
      </div>
      <div className="flex w-full flex-col gap-1">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
    </article>
  );
}
