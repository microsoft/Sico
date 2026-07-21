import { Skeleton } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX } from "react";

// Loading fallback for the suggested-tasks Suspense boundary on the DW home: the
// "SUGGESTED TASKS" divider over three placeholder rows shaped like TaskRow
// (icon chip + message line, py-2) so the swap to real rows has no height jump.
// No entrance animation — a loading placeholder shows immediately (the
// <Skeleton> pulse already signals "loading"); the reveal stagger belongs to the
// real content.
export function SuggestedTasksSkeleton(): JSX.Element {
  // Distinct widths double as React keys — no array-index key needed.
  const ROW_WIDTHS = ["w-3/4", "w-2/3", "w-2/5"];
  return (
    <div className="mt-6 flex flex-col gap-2 pb-2" aria-hidden="true">
      <div className="flex items-center gap-2">
        <span className="text-foreground-faint text-xs tracking-wider uppercase">
          Suggested tasks
        </span>
        <span className="border-divider flex-1 border-t" />
      </div>
      {ROW_WIDTHS.map((width) => (
        // Mirrors TaskRow: gap-3 + py-2 around a size-7 chip and a message line.
        <div key={width} className="flex items-center gap-3 py-2 pr-3 pl-1">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <Skeleton className={cn("h-4", width)} />
        </div>
      ))}
    </div>
  );
}
