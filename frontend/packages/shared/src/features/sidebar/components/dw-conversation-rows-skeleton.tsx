import { Skeleton } from "@sico/ui";
import { type JSX } from "react";

import { DW_PREVIEW } from "../constants";

// The conversation-row placeholders — `count` skeleton bars, each matching a
// real row (h-8, `px-2`, `flex-1` bar mirroring the truncated title). Shared by
// the first-load skeleton (`DwConversationNavSkeleton`) AND the load-more
// indicator in `dw-conversation-nav`, so the two can't drift. Defaults to
// `DW_PREVIEW`.
export function DwConversationRowsSkeleton({
  count = DW_PREVIEW,
}: {
  readonly count?: number;
}): JSX.Element {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key -- static placeholder count
          key={index}
          data-testid="conversation-skeleton-row"
          className="flex h-8 items-center px-2"
        >
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </>
  );
}
