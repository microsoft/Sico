import { Skeleton } from "@sico/ui";
import type { ReactElement } from "react";

// Mirrors SetupBody (header + Basic Info card + Skill section) so the route's
// suspense fallback keeps the layout stable instead of flashing blank.
export function SetupSkeleton(): ReactElement {
  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between pr-3 pl-4">
        <div className="flex items-center gap-2">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-5 w-40" />
        </div>
        <Skeleton className="h-8 w-20" />
      </header>
      <div className="min-h-0 flex-1 overflow-hidden pb-6">
        <div className="mx-auto flex w-full max-w-230 flex-col gap-6 px-6 pt-2">
          <div className="flex w-full flex-col gap-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-6 w-14" />
            </div>
            <div className="bg-surface-basic border-stroke-subtle-card-rest flex gap-4 rounded-xl border p-6">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-6 w-14" />
            </div>
            {["c1", "c2"].map((id) => (
              <Skeleton key={id} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
