import { Skeleton } from "@sico/ui";
import { ChevronLeft } from "lucide-react";
import { type JSX } from "react";

import { DwConversationRowsSkeleton } from "./dw-conversation-rows-skeleton";

// Loading placeholder for the sidebar's conversation mode (DwConversationNav):
// mirrors the real block's three-row shape — "Session" back-header, "New
// session" row, then a few conversation rows — so the swap-in doesn't jump.
export function DwConversationNavSkeleton(): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Loading conversations"
      className="flex min-h-0 flex-1 flex-col gap-1"
    >
      {/* Back header — chevron + a short label bar, matching the real
          `px-1` inset and h-9 height. */}
      <div className="flex h-9 items-center gap-1 px-1">
        <ChevronLeft
          aria-hidden="true"
          className="text-foreground-tertiary size-4 shrink-0"
        />
        <Skeleton className="h-3 w-16" />
      </div>
      {/* New session — mirrors the real secondary Button: a `p-2` wrapper
          around an h-9 (size-lg) button-shaped bar, so the swap-in keeps the
          same 52px block height and doesn't shift the rows below. */}
      <div className="p-2">
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <DwConversationRowsSkeleton />
    </div>
  );
}
