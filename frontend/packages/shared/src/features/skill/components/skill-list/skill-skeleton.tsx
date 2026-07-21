import { Skeleton } from "@sico/ui";
import type { ReactElement } from "react";

// Mirrors the expanded content (tabs bar + file-explorer shell with header,
// sidebar tree, and code body) so the swap to real content doesn't shift layout.
export function SkillSkeleton(): ReactElement {
  return (
    <div className="flex flex-col" aria-hidden>
      <div className="border-divider flex gap-4 border-b pb-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="border-stroke-subtle-card-rest mt-5 h-96 overflow-hidden rounded-lg border">
        <div className="bg-surface-sunken border-stroke-subtle-card-rest flex h-8 items-center gap-2 border-b px-3">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex h-[calc(100%-2rem)]">
          <div className="border-divider w-40 shrink-0 space-y-2 border-r p-3">
            {["t1", "t2", "t3", "t4"].map((id) => (
              <Skeleton
                key={id}
                data-testid="skill-skeleton-row"
                className="h-5 w-full"
              />
            ))}
          </div>
          <div className="flex-1 space-y-2 p-3">
            {["c1", "c2", "c3", "c4", "c5"].map((id) => (
              <Skeleton key={id} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
