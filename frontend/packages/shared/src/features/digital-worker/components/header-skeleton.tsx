import { Skeleton } from "@sico/ui";
import type { JSX } from "react";

/**
 * Placeholder for `<Header>` while its agent-detail query is in flight. Mirrors
 * the header's layout (h-12, the avatar + name/role button on the left, the
 * right-aligned actions slot) so the swap doesn't shift the row. The avatar
 * placeholder tracks `DwAvatar size="xs"` (size-5); only the avatar + name text
 * are skeletons.
 */
export function HeaderSkeleton(): JSX.Element {
  return (
    <header
      aria-hidden="true"
      data-testid="header-skeleton"
      className="flex h-12 items-center justify-between gap-0.5 px-5"
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <div className="flex items-center gap-2 px-1 py-0.5">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="size-7 shrink-0 rounded-md" />
    </header>
  );
}
